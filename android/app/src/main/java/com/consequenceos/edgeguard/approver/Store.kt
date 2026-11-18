package com.consequenceos.edgeguard.approver

import android.content.Context
import android.content.SharedPreferences
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import java.time.Instant

/** One escalated call waiting for Mei Lin, as the console wrote it. */
data class ApprovalRequest(
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
    val createdAt: Instant?,
)

data class Explanation(val text: String, val source: String)

/**
 * Firestore access for the approver: register this phone's public key, follow the
 * requests the console writes, and answer each once with a signed decision. The
 * collection names and fields match src/ops/approvals.ts and firestore.rules.
 */
object Store {
    const val APPROVER_ID = "mei.lin"
    const val NAME = "Mei Lin"
    const val ROLE = "IT administrator"

    private val db: FirebaseFirestore get() = FirebaseFirestore.getInstance()
    private lateinit var prefs: SharedPreferences

    /** Call once from the Application, before any screen uses the store. */
    fun init(context: Context) {
        prefs = context.getSharedPreferences("edge-guard-approver", Context.MODE_PRIVATE)
    }

    /**
     * Requests this phone has answered. Kept on the phone rather than read from
     * approvalResponses: anyone can write an answer there, so an answer in that
     * collection does not mean this phone answered.
     */
    private fun answered(): Set<String> = prefs.getStringSet("answered", emptySet()) ?: emptySet()

    private fun markAnswered(receiptId: String) {
        prefs.edit().putStringSet("answered", (answered() + receiptId).toSet()).apply()
    }

    /** Registers the key once; the rules make registrations create-only. */
    fun register(onDone: (String?) -> Unit) {
        val keyId = ApproverKey.fingerprint()
        val ref = db.collection("approvers").document(keyId)
        ref.get()
            .addOnSuccessListener { snap ->
                if (snap.exists()) {
                    onDone(null)
                    return@addOnSuccessListener
                }
                ref.set(
                    mapOf(
                        "approverId" to APPROVER_ID,
                        "name" to NAME,
                        "role" to ROLE,
                        "platform" to "android",
                        "publicKey" to ApproverKey.publicKeyJwk(),
                        "registeredAt" to FieldValue.serverTimestamp(),
                    ),
                ).addOnSuccessListener { onDone(null) }.addOnFailureListener { onDone(it.message) }
            }
            .addOnFailureListener { onDone(it.message) }
    }

    @Suppress("UNCHECKED_CAST")
    private fun parse(id: String, data: Map<String, Any?>): ApprovalRequest? {
        val receipt = data["receipt"] as? Map<String, Any?> ?: return null
        val entry = data["registryEntry"] as? Map<String, Any?> ?: emptyMap()
        return ApprovalRequest(
            receiptId = id,
            digest = receipt["digest"] as? String ?: return null,
            tool = data["tool"] as? String ?: "unknown",
            args = data["args"] as? Map<String, Any?> ?: emptyMap(),
            agent = data["agent"] as? String ?: "",
            reason = data["reason"] as? String ?: "",
            rationale = (data["rationale"] as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
            system = entry["system"] as? String ?: "unknown system",
            sensitivity = entry["sensitivity"] as? String ?: "restricted",
            reversible = entry["reversible"] as? Boolean ?: false,
            registered = entry["registered"] as? Boolean ?: false,
            createdAt = (data["createdAt"] as? com.google.firebase.Timestamp)?.toDate()?.toInstant(),
        )
    }

    /**
     * Follows recent requests and reports the ones this phone has not answered. Returns
     * the listeners to remove when the screen closes.
     */
    fun watchPending(onChange: (List<ApprovalRequest>) -> Unit, onError: (String) -> Unit): List<ListenerRegistration> {
        val requestListener = db.collection("approvalRequests")
            .orderBy("createdAt", Query.Direction.DESCENDING).limit(20)
            .addSnapshotListener { snap, error ->
                if (error != null) return@addSnapshotListener onError(error.message ?: "Could not read requests.")
                val done = answered()
                val requests = snap?.documents?.mapNotNull { d -> d.data?.let { parse(d.id, it) } } ?: emptyList()
                onChange(requests.filter { it.receiptId !in done })
            }
        return listOf(requestListener)
    }

    fun load(receiptId: String, onLoaded: (ApprovalRequest?) -> Unit, onError: (String) -> Unit) {
        db.collection("approvalRequests").document(receiptId).get()
            .addOnSuccessListener { snap -> onLoaded(snap.data?.let { parse(snap.id, it) }) }
            .addOnFailureListener { onError(it.message ?: "Could not read the request.") }
    }

    /** The messages the console verifies; they must match src/ops/toolGuard.ts and approvals.ts. */
    fun message(request: ApprovalRequest, approve: Boolean, decidedAt: String): String {
        val kind = if (approve) "approval" else "rejection"
        return "edge-guard/$kind:${request.receiptId}:${request.digest}:$APPROVER_ID:$decidedAt"
    }

    /**
     * Signs the decision in Keystore and writes it under a new ID. A request can collect
     * several answers, so an answer written by anyone else cannot block this one; the
     * console acts on the first answer signed by a paired key.
     */
    fun answer(request: ApprovalRequest, approve: Boolean, explanation: Explanation?, onDone: (String?) -> Unit) {
        val decidedAt = Instant.now().toString()
        val signature = ApproverKey.sign(message(request, approve, decidedAt))
        db.collection("approvalResponses").document().set(
            mapOf(
                "receiptId" to request.receiptId,
                "decision" to if (approve) "approve" else "reject",
                "approverId" to APPROVER_ID,
                "keyId" to ApproverKey.fingerprint(),
                "decidedAt" to decidedAt,
                "signature" to signature,
                "explanation" to explanation?.let { mapOf("text" to it.text, "source" to it.source) },
                "respondedAt" to FieldValue.serverTimestamp(),
            ),
        ).addOnSuccessListener {
            markAnswered(request.receiptId)
            onDone(null)
        }.addOnFailureListener { onDone(it.message) }
    }
}
