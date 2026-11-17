package com.consequenceos.edgeguard.approver

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
     * Follows recent requests and answers, and reports the ones still waiting. Returns the
     * listeners to remove when the screen closes.
     */
    fun watchPending(onChange: (List<ApprovalRequest>) -> Unit, onError: (String) -> Unit): List<ListenerRegistration> {
        var requests: List<ApprovalRequest> = emptyList()
        var answered: Set<String> = emptySet()
        fun publish() = onChange(requests.filter { it.receiptId !in answered })
        val requestListener = db.collection("approvalRequests")
            .orderBy("createdAt", Query.Direction.DESCENDING).limit(20)
            .addSnapshotListener { snap, error ->
                if (error != null) return@addSnapshotListener onError(error.message ?: "Could not read requests.")
                requests = snap?.documents?.mapNotNull { d -> d.data?.let { parse(d.id, it) } } ?: emptyList()
                publish()
            }
        val responseListener = db.collection("approvalResponses")
            .orderBy("respondedAt", Query.Direction.DESCENDING).limit(50)
            .addSnapshotListener { snap, error ->
                if (error != null) return@addSnapshotListener onError(error.message ?: "Could not read answers.")
                answered = snap?.documents?.map { it.id }?.toSet() ?: emptySet()
                publish()
            }
        return listOf(requestListener, responseListener)
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

    /** Signs the decision in Keystore and writes it. The rules allow one answer per request. */
    fun answer(request: ApprovalRequest, approve: Boolean, explanation: Explanation?, onDone: (String?) -> Unit) {
        val decidedAt = Instant.now().toString()
        val signature = ApproverKey.sign(message(request, approve, decidedAt))
        db.collection("approvalResponses").document(request.receiptId).set(
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
        ).addOnSuccessListener { onDone(null) }.addOnFailureListener { onDone(it.message) }
    }
}
