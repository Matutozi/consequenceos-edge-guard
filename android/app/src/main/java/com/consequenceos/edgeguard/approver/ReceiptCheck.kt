package com.consequenceos.edgeguard.approver

import java.math.BigDecimal
import java.math.BigInteger
import java.math.MathContext
import java.math.RoundingMode
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.util.Base64

/**
 * Checks an approval request against the receipt it carries, before Mei Lin is asked to
 * sign anything. What she approves is the receipt's digest, so what she sees must be what
 * the digest covers: the screen is built from the receipt alone, never from the copies of
 * tool, arguments and reason that sit beside it in the request.
 *
 * The digest is recomputed exactly as src/domain/receipt.ts computes it (SHA-256 over
 * canonical JSON, as JavaScript's JSON.stringify writes it), and the signature is checked
 * with the public key the run recorded. Pure JVM code, so it runs in unit tests; the test
 * vectors in src/test/resources are produced by the TypeScript code.
 */
object ReceiptCheck {
    const val DIGEST_ALGORITHM = "sha256-canonical-json-v1"

    /** What the screen may show: everything here is covered by the receipt's digest. */
    data class SignedCall(
        val receiptId: String,
        val digest: String,
        val tool: String,
        val args: Map<String, Any?>,
        val agent: String,
        val reason: String,
        val rationale: List<String>,
        val system: String,
        val sensitivity: String,
        val reversible: Boolean,
        val registered: Boolean,
    )

    sealed class Result {
        data class Verified(val call: SignedCall) : Result()

        /** [why] is one plain sentence for the approver. */
        data class Refused(val why: String) : Result()
    }

    /**
     * @param receipt the receipt as stored in the request.
     * @param signature the run's signature over the receipt's digest, as hex.
     * @param runPublicKey the public key the run recorded in the audit log, or null when the
     *   run is not there.
     */
    fun check(receiptId: String, receipt: Map<String, Any?>, signature: String?, runPublicKey: Map<String, Any?>?): Result {
        val digest = receipt["digest"] as? String ?: return Result.Refused("The request has no receipt digest.")
        if (receipt["id"] != receiptId) return Result.Refused("The receipt in the request is for a different call.")
        if (receipt["digestAlgorithm"] != DIGEST_ALGORITHM) {
            return Result.Refused("The receipt uses a digest this app does not know, so it cannot be checked.")
        }
        val recomputed = try {
            sha256Hex(canonicalJson(receipt - "digest"))
        } catch (e: IllegalArgumentException) {
            return Result.Refused("The receipt holds a value this app cannot check (${e.message}).")
        }
        if (recomputed != digest) {
            return Result.Refused("The receipt was changed after Edge Guard issued it: its contents no longer match its digest.")
        }
        if (runPublicKey == null) return Result.Refused("The run that issued this receipt is not in the audit log, so its signature cannot be checked.")
        if (signature == null || !verify(runPublicKey, "edge-guard/receipt:$digest", signature)) {
            return Result.Refused("The receipt is not signed by the run that issued it.")
        }

        val decision = receipt["decision"] as? Map<*, *>
        if (decision?.get("decision") != "require_approval") {
            return Result.Refused("Edge Guard did not ask for approval of this call, so there is nothing to approve.")
        }
        val toolCall = receipt["toolCall"] as? Map<*, *> ?: return Result.Refused("The receipt does not name a call.")
        val tool = toolCall["tool"] as? String ?: return Result.Refused("The receipt does not name a tool.")
        val args = (toolCall["args"] as? Map<*, *>)?.entries?.associate { (k, v) -> k.toString() to v }
            ?: return Result.Refused("The receipt does not record the call's arguments.")
        val proposal = receipt["proposal"] as? Map<*, *> ?: return Result.Refused("The receipt does not describe the call.")
        val target = proposal["target"] as? String ?: "unknown system"

        return Result.Verified(
            SignedCall(
                receiptId = receiptId,
                digest = digest,
                tool = tool,
                args = args,
                agent = proposal["actor"] as? String ?: "",
                reason = proposal["context"] as? String ?: "",
                rationale = (decision["rationale"] as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
                system = target,
                sensitivity = proposal["dataSensitivity"] as? String ?: "restricted",
                reversible = proposal["reversible"] as? Boolean ?: false,
                // src/ops/toolGuard.ts toProposal marks an unregistered tool in the target.
                registered = !target.contains("is not registered"),
            ),
        )
    }

    // ------------------------------------------------------------ canonical JSON

    /**
     * JSON with object keys sorted, byte for byte as canonicalJson in src/domain/receipt.ts
     * writes it: JSON.stringify over objects whose keys were inserted in sorted order. Throws
     * IllegalArgumentException for a value JSON cannot hold.
     */
    fun canonicalJson(value: Any?): String = StringBuilder().also { write(it, value) }.toString()

    private fun write(out: StringBuilder, value: Any?) {
        when (value) {
            null -> out.append("null")
            is Boolean -> out.append(value)
            is String -> quote(out, value)
            is Number -> out.append(jsNumber(value))
            is Map<*, *> -> {
                out.append('{')
                orderedKeys(value.keys.map { it as? String ?: throw IllegalArgumentException("a key that is not text") })
                    .forEachIndexed { i, key ->
                        if (i > 0) out.append(',')
                        quote(out, key)
                        out.append(':')
                        write(out, value[key])
                    }
                out.append('}')
            }
            is List<*> -> {
                out.append('[')
                value.forEachIndexed { i, item ->
                    if (i > 0) out.append(',')
                    write(out, item)
                }
                out.append(']')
            }
            else -> throw IllegalArgumentException("a ${value::class.java.simpleName}")
        }
    }

    private const val MAX_ARRAY_INDEX = 4294967294L

    private fun isArrayIndex(key: String): Boolean =
        key.isNotEmpty() && key.length <= 10 && (key == "0" || (key[0] in '1'..'9' && key.all { it in '0'..'9' })) &&
            key.toLong() <= MAX_ARRAY_INDEX

    /**
     * The order JSON.stringify writes an object's keys in. The keys are sorted (by UTF-16
     * code units, as Array.prototype.sort does), but JavaScript always lists integer-like keys
     * ("9", "10") first, in numeric order, whatever order they were inserted in.
     */
    fun orderedKeys(keys: Collection<String>): List<String> {
        val (indices, names) = keys.partition(::isArrayIndex)
        return indices.sortedBy { it.toLong() } + names.sorted()
    }

    private fun quote(out: StringBuilder, s: String) {
        out.append('"')
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '"' -> out.append("\\\"")
                c == '\\' -> out.append("\\\\")
                c == '\b' -> out.append("\\b")
                c == '\u000C' -> out.append("\\f")
                c == '\n' -> out.append("\\n")
                c == '\r' -> out.append("\\r")
                c == '\t' -> out.append("\\t")
                c < ' ' -> out.append("\\u%04x".format(c.code))
                c.isHighSurrogate() && i + 1 < s.length && s[i + 1].isLowSurrogate() -> {
                    out.append(c).append(s[i + 1])
                    i++
                }
                // A lone surrogate, written as an escape by well-formed JSON.stringify.
                c.isSurrogate() -> out.append("\\u%04x".format(c.code))
                else -> out.append(c)
            }
            i++
        }
        out.append('"')
    }

    /** A number as JavaScript's Number.prototype.toString writes it, which JSON.stringify uses. */
    fun jsNumber(n: Number): String {
        when (n) {
            is Int, is Long, is Short, is Byte -> return n.toString()
            is BigInteger -> return n.toString()
        }
        val d = n.toDouble()
        if (d.isNaN() || d.isInfinite()) return "null"
        if (d == 0.0) return "0"

        // The fewest significant digits that read back as the same double; with several of
        // that length, the closest, which rounding the exact value gives (ECMA-262 Number::toString).
        val exact = BigDecimal(d)
        val shortest = (1..17).asSequence()
            .map { exact.round(MathContext(it, RoundingMode.HALF_EVEN)) }
            .first { it.toDouble() == d }
            .stripTrailingZeros()
        val digits = shortest.unscaledValue().abs().toString()
        val k = digits.length
        val e = k - shortest.scale() // the value is 0.digits × 10^e
        val sign = if (d < 0) "-" else ""
        val body = when {
            e in k..21 -> digits + "0".repeat(e - k)
            e in 1..21 -> digits.substring(0, e) + "." + digits.substring(e)
            e in -5..0 -> "0." + "0".repeat(-e) + digits
            else -> {
                val exponent = e - 1
                val mantissa = if (k == 1) digits else digits[0] + "." + digits.substring(1)
                mantissa + "e" + (if (exponent < 0) "-" else "+") + kotlin.math.abs(exponent)
            }
        }
        return sign + body
    }

    fun sha256Hex(text: String): String =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    // ------------------------------------------------------------ signatures

    private val p256: ECParameterSpec by lazy {
        AlgorithmParameters.getInstance("EC").apply { init(ECGenParameterSpec("secp256r1")) }
            .getParameterSpec(ECParameterSpec::class.java)
    }

    /**
     * Verifies a WebCrypto ECDSA P-256 signature (raw r || s, as 128 hex characters) over
     * [message] with a public key given as a JWK. Any malformed input is simply invalid.
     */
    fun verify(jwk: Map<String, Any?>, message: String, signatureHex: String): Boolean = try {
        require(jwk["kty"] == "EC" && jwk["crv"] == "P-256")
        require(signatureHex.matches(Regex("^[0-9a-f]{128}$")))
        val decoder = Base64.getUrlDecoder()
        val x = BigInteger(1, decoder.decode(jwk["x"] as String))
        val y = BigInteger(1, decoder.decode(jwk["y"] as String))
        val key = KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(ECPoint(x, y), p256))
        val r = BigInteger(signatureHex.substring(0, 64), 16)
        val s = BigInteger(signatureHex.substring(64), 16)
        Signature.getInstance("SHA256withECDSA").run {
            initVerify(key)
            update(message.toByteArray(Charsets.UTF_8))
            verify(derSignature(r, s))
        }
    } catch (e: Exception) {
        false
    }

    /** ECDSA DER: SEQUENCE { INTEGER r, INTEGER s }. Short lengths suffice for P-256. */
    private fun derSignature(r: BigInteger, s: BigInteger): ByteArray {
        fun integer(v: BigInteger): ByteArray = v.toByteArray().let { byteArrayOf(0x02, it.size.toByte()) + it }
        val body = integer(r) + integer(s)
        return byteArrayOf(0x30, body.size.toByte()) + body
    }
}
