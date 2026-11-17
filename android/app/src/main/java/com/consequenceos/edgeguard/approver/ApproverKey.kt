package com.consequenceos.edgeguard.approver

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

/**
 * Mei Lin's signing key. It is generated inside Android Keystore and the private half
 * never leaves it: the app can ask Keystore to sign, but cannot read the key.
 *
 * Signatures are converted to the raw r || s form (64 bytes, 128 hex characters) that
 * the console verifies with WebCrypto. The fingerprint is computed exactly as the
 * console computes it, so the person pairing the phone can compare the two.
 */
object ApproverKey {
    private const val ALIAS = "edge-guard-approver"
    private const val COORDINATE_BYTES = 32

    private val keyStore: KeyStore by lazy { KeyStore.getInstance("AndroidKeyStore").apply { load(null) } }

    private fun ensureKey() {
        if (keyStore.containsAlias(ALIAS)) return
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        generator.initialize(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .build(),
        )
        generator.generateKeyPair()
    }

    private fun publicKey(): ECPublicKey {
        ensureKey()
        return keyStore.getCertificate(ALIAS).publicKey as ECPublicKey
    }

    private fun fixedLength(value: BigInteger): ByteArray {
        val bytes = value.toByteArray()
        return when {
            bytes.size == COORDINATE_BYTES -> bytes
            bytes.size > COORDINATE_BYTES -> bytes.copyOfRange(bytes.size - COORDINATE_BYTES, bytes.size)
            else -> ByteArray(COORDINATE_BYTES - bytes.size) + bytes
        }
    }

    private fun base64Url(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

    private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

    /** The public key as a JWK, as the console and the Firestore rules expect it. */
    fun publicKeyJwk(): Map<String, String> {
        val point = publicKey().w
        return mapOf(
            "kty" to "EC",
            "crv" to "P-256",
            "x" to base64Url(fixedLength(point.affineX)),
            "y" to base64Url(fixedLength(point.affineY)),
        )
    }

    /** First 16 hex characters of SHA-256 over the raw x and y coordinates. */
    fun fingerprint(): String {
        val point = publicKey().w
        val digest = MessageDigest.getInstance("SHA-256").digest(fixedLength(point.affineX) + fixedLength(point.affineY))
        return hex(digest).substring(0, 16)
    }

    /** "ab12cd34ef567890" becomes "AB12 CD34 EF56 7890", as the console shows it. */
    fun formatted(fingerprint: String): String = fingerprint.uppercase().chunked(4).joinToString(" ")

    /** Signs with SHA256withECDSA in Keystore and returns the raw r || s signature as hex. */
    fun sign(message: String): String {
        ensureKey()
        val privateKey = keyStore.getKey(ALIAS, null) as PrivateKey
        val der = Signature.getInstance("SHA256withECDSA").run {
            initSign(privateKey)
            update(message.toByteArray(Charsets.UTF_8))
            sign()
        }
        return hex(derToRaw(der))
    }

    /** ECDSA DER is SEQUENCE { INTEGER r, INTEGER s }; WebCrypto expects r || s, 32 bytes each. */
    internal fun derToRaw(der: ByteArray): ByteArray {
        var i = 0
        require(der[i++].toInt() == 0x30) { "Not a DER sequence" }
        // Sequence length: short form, or long form with one length byte (enough for P-256).
        if (der[i].toInt() and 0x80 != 0) i += 1 + (der[i].toInt() and 0x7f) else i++
        fun readInteger(): BigInteger {
            require(der[i++].toInt() == 0x02) { "Not a DER integer" }
            val length = der[i++].toInt()
            val value = BigInteger(1, der.copyOfRange(i, i + length))
            i += length
            return value
        }
        val r = readInteger()
        val s = readInteger()
        return fixedLength(r) + fixedLength(s)
    }
}
