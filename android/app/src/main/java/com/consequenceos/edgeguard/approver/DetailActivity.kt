package com.consequenceos.edgeguard.approver

import android.app.Activity
import android.os.Bundle
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject

/** One escalated call: what it does, why Edge Guard asked, an explanation, and a signed answer. */
class DetailActivity : Activity() {
    private val scope = MainScope()
    private var explanation: Explanation? = null
    private var answering = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val receiptId = intent.getStringExtra("receiptId") ?: return finish()
        val content = Ui.column(this)
        setContentView(ScrollView(this).apply {
            setBackgroundColor(android.graphics.Color.WHITE)
            addView(content)
        })
        content.addView(Ui.text(this, "Loading the request.", 14f, Ui.TEXT_2))
        Store.load(
            receiptId,
            onLoaded = { request ->
                content.removeAllViews()
                if (request == null) content.addView(Ui.text(this, "This request no longer exists.", 14f, Ui.DENY))
                else render(content, request)
            },
            onError = { message ->
                content.removeAllViews()
                content.addView(Ui.text(this, "Could not read the request: $message", 14f, Ui.DENY))
            },
        )
    }

    private fun render(content: LinearLayout, request: ApprovalRequest) {
        content.addView(Ui.text(this, "Needs your approval", 12f, Ui.REVIEW, bold = true))
        content.addView(Ui.text(this, request.tool, 20f, bold = true, mono = true))
        content.addView(Ui.text(this, JSONObject(request.args).toString(), 13f, Ui.TEXT_2, mono = true))

        content.addView(Ui.label(this, "Explanation"))
        val explanationText = Ui.text(this, "Preparing an explanation.", 14f, Ui.TEXT_2)
        val explanationSource = Ui.text(this, "", 12f, Ui.TEXT_3)
        content.addView(explanationText)
        content.addView(explanationSource)

        content.addView(Ui.label(this, "Why Edge Guard asked"))
        request.rationale.forEach { content.addView(Ui.text(this, it, 14f)) }

        content.addView(Ui.label(this, "Registry entry"))
        content.addView(Ui.text(this, "${request.system}. ${request.sensitivity} data. ${if (request.reversible) "Can be undone." else "Cannot be undone."}", 14f))
        if (!request.registered) content.addView(Ui.text(this, "${request.tool} is not in the registry.", 14f, Ui.DENY))

        content.addView(Ui.label(this, "The agent's reason (untrusted)"))
        content.addView(Ui.text(this, request.reason.ifEmpty { "None given." }, 14f, Ui.TEXT_2))
        content.addView(Ui.text(this, "Agent: ${request.agent}", 12f, Ui.TEXT_3))

        val result = Ui.text(this, "", 13f, Ui.TEXT_3)
        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, Ui.dp(context, 24), 0, Ui.dp(context, 8))
        }
        fun decide(approve: Boolean) {
            if (answering) return
            answering = true
            result.text = "Signing in Android Keystore and sending."
            Store.answer(request, approve, explanation) { error ->
                if (error == null) {
                    Toast.makeText(this, if (approve) "Approved and signed" else "Rejected and signed", Toast.LENGTH_SHORT).show()
                    finish()
                } else {
                    answering = false
                    result.text = "Could not send the answer: $error"
                    result.setTextColor(Ui.DENY)
                }
            }
        }
        buttons.addView(Ui.button(this, "Approve", Ui.ALLOW) { decide(true) })
        buttons.addView(Ui.button(this, "Reject", null) { decide(false) })
        content.addView(buttons)
        content.addView(result)
        content.addView(Ui.text(this, "Your answer is signed with this phone's key ${ApproverKey.formatted(ApproverKey.fingerprint())}.", 12f, Ui.TEXT_3))

        scope.launch {
            val e = Explainer.explain(request)
            explanation = e
            explanationText.text = e.text
            explanationText.setTextColor(Ui.TEXT)
            explanationSource.text = when (e.source) {
                "on-device" -> "Explained by Gemini Nano on this phone. Nothing left the phone."
                "cloud" -> "Explained in the cloud through Firebase AI Logic. This phone has no on-device model."
                else -> if (request.sensitivity == "confidential" || request.sensitivity == "restricted")
                    "Explained from the registry. This call touches ${request.sensitivity} data and this phone has no on-device model, so nothing was sent to the cloud."
                else "Explained from the registry; the model was not available."
            }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
