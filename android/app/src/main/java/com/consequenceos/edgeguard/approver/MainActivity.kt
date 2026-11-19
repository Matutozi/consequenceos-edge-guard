package com.consequenceos.edgeguard.approver

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import com.google.firebase.firestore.ListenerRegistration
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Requests waiting for Mei Lin, updated live from Firestore, and this phone's fingerprint. */
class MainActivity : Activity() {
    private var listeners: List<ListenerRegistration> = emptyList()
    private lateinit var status: TextView
    private lateinit var empty: TextView
    private lateinit var adapter: ArrayAdapter<ApprovalRequest>
    private val time = DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneId.systemDefault())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = Ui.column(this).apply { setBackgroundColor(android.graphics.Color.WHITE) }

        root.addView(Ui.text(this, "Edge Guard Approver", 20f, bold = true))
        root.addView(Ui.text(this, "${Store.NAME}, ${Store.ROLE}", 14f, Ui.TEXT_2))

        root.addView(Ui.label(this, "This phone's key fingerprint"))
        root.addView(Ui.text(this, ApproverKey.formatted(ApproverKey.fingerprint()), 18f, Ui.GUARD, mono = true))
        root.addView(
            Ui.text(
                this,
                "In the Edge Guard console, choose Pair a phone and trust only this fingerprint. The key lives in this phone's Android Keystore and never leaves it.",
                12f,
                Ui.TEXT_3,
            ),
        )
        status = Ui.text(this, "Registering this phone.", 12f, Ui.TEXT_3)
        root.addView(status)

        root.addView(Ui.label(this, "Waiting for your approval"))
        empty = Ui.text(this, "Nothing is waiting. When Edge Guard escalates a call in the console, it appears here.", 14f, Ui.TEXT_2)
        root.addView(empty)

        adapter = object : ArrayAdapter<ApprovalRequest>(this, 0, mutableListOf()) {
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val request = getItem(position)!!
                return LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    val p = Ui.dp(context, 12)
                    setPadding(p, p, p, p)
                    background = Ui.box(context, Ui.SURFACE_2, Ui.BORDER)
                    layoutParams = ViewGroup.MarginLayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                    // From the receipt, not yet checked; the detail screen checks it before showing more.
                    addView(Ui.text(context, request.tool, 15f, bold = true, mono = true))
                    addView(Ui.text(context, request.argsPreview, 13f, Ui.TEXT_2))
                    addView(Ui.text(context, "${request.system}, ${request.sensitivity} data, ${request.createdAt?.let { time.format(it) } ?: ""}", 12f, Ui.TEXT_3))
                }
            }
        }
        val list = ListView(this).apply {
            this.adapter = this@MainActivity.adapter
            dividerHeight = Ui.dp(context, 8)
            divider = null
            setOnItemClickListener { _, _, position, _ ->
                val request = this@MainActivity.adapter.getItem(position) ?: return@setOnItemClickListener
                startActivity(Intent(context, DetailActivity::class.java).putExtra("receiptId", request.receiptId))
            }
        }
        root.addView(list, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        Store.register { error ->
            status.text = if (error == null) "Registered. Waiting for requests." else "Could not register this phone: $error"
            status.setTextColor(if (error == null) Ui.TEXT_3 else Ui.DENY)
        }
    }

    override fun onStart() {
        super.onStart()
        listeners = Store.watchPending(
            onChange = { pending ->
                adapter.clear()
                adapter.addAll(pending)
                empty.visibility = if (pending.isEmpty()) View.VISIBLE else View.GONE
            },
            onError = { message ->
                status.text = "Could not read requests: $message"
                status.setTextColor(Ui.DENY)
            },
        )
    }

    override fun onStop() {
        listeners.forEach { it.remove() }
        listeners = emptyList()
        super.onStop()
    }
}
