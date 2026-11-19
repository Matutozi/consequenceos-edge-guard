package com.consequenceos.edgeguard.approver

import android.content.Context
import android.content.SharedPreferences
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import java.time.Instant

/**
 * One escalated call waiting for Mei Lin, as the console wrote it. Nothing in it is trusted
 * until [Store.verify] has checked the receipt: the request also carries copies of the tool,
 * arguments and reason, but anyone who can write a request can make those say anything, so
 * they are never read. What she signs is the receipt's digest, so what she sees comes from it.
 */
data class ApprovalRequest(
    val receiptId: String,
    val runId: String,
    val receipt: Map<String, Any?>,
    val signature: String?,
    val createdAt: Instant?,
) {
    private val toolCall get() = receipt["toolCall"] as? Map<*, *>
    private val proposal get() = receipt["proposal"] as? Map<*, *>

    /** For the list only, before the receipt is checked. The detail screen shows nothing unverified. */
    val tool: String get() = toolCall?.get("tool") as? String ?: "unknown tool"
    val argsPreview: String get() =
        (toolCall?.get("args") as? Map<*, *>)?.entries?.joinToString(", ") { "${it.key}: ${it.value}" } ?: ""
    val system: String get() = proposal?.get("target") as? String ?: "unknown system"
    val sensitivity: String get() = proposal?.get("dataSensitivity") as? String ?: "restricted"
}

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
        return ApprovalRequest(
            receiptId = id,
            runId = data["runId"] as? String ?: "",
            receipt = receipt,
            signature = data["signature"] as? String,
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

    /**
     * Checks the request's receipt against its digest and against the key its run recorded in
     * the audit log (see [ReceiptCheck]). Only a verified call may be shown, explained or approved.
     */
    @Suppress("UNCHECKED_CAST")
    fun verify(request: ApprovalRequest, onResult: (ReceiptCheck.Result) -> Unit, onError: (String) -> Unit) {
        val check = { key: Map<String, Any?>? -> ReceiptCheck.check(request.receiptId, request.receipt, request.signature, key) }
        if (request.runId.isEmpty()) return onResult(check(null))
        db.collection("runs").document(request.runId).get()
            .addOnSuccessListener { snap -> onResult(check(snap.get("publicKey") as? Map<String, Any?>)) }
            .addOnFailureListener { onError(it.message ?: "Could not read the run that issued this request.") }
    }

    /** The messages the console verifies; they must match src/ops/toolGuard.ts and approvals.ts. */
    fun message(call: ReceiptCheck.SignedCall, approve: Boolean, decidedAt: String): String {
        val kind = if (approve) "approval" else "rejection"
        return "edge-guard/$kind:${call.receiptId}:${call.digest}:$APPROVER_ID:$decidedAt"
    }

    /**
     * Signs the decision in Keystore and writes it under a new ID. A request can collect
     * several answers, so an answer written by anyone else cannot block this one; the
     * console acts on the first answer signed by a paired key. Takes only a verified call, so
     * nothing unchecked can be signed.
     */
    fun answer(call: ReceiptCheck.SignedCall, approve: Boolean, explanation: Explanation?, onDone: (String?) -> Unit) {
        val decidedAt = Instant.now().toString()
        val signature = ApproverKey.sign(message(call, approve, decidedAt))
        db.collection("approvalResponses").document().set(
            mapOf(
                "receiptId" to call.receiptId,
                "decision" to if (approve) "approve" else "reject",
                "approverId" to APPROVER_ID,
                "keyId" to ApproverKey.fingerprint(),
                "decidedAt" to decidedAt,
                "signature" to signature,
                "explanation" to explanation?.let { mapOf("text" to it.text, "source" to it.source) },
                "respondedAt" to FieldValue.serverTimestamp(),
            ),
        ).addOnSuccessListener {
            markAnswered(call.receiptId)
            onDone(null)
        }.addOnFailureListener { onDone(it.message) }
    }
}
