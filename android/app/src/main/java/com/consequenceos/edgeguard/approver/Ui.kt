package com.consequenceos.edgeguard.approver

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Small view helpers. Same palette as the web console: greys for structure, colour for meaning. */
object Ui {
    const val TEXT = 0xFF18181B.toInt()
    const val TEXT_2 = 0xFF52525B.toInt()
    const val TEXT_3 = 0xFF6B6B74.toInt()
    const val BORDER = 0xFFE4E4E7.toInt()
    const val SURFACE_2 = 0xFFF4F4F5.toInt()
    const val GUARD = 0xFF4F46E5.toInt()
    const val ALLOW = 0xFF15803D.toInt()
    const val REVIEW = 0xFFA16207.toInt()
    const val DENY = 0xFFB91C1C.toInt()

    fun dp(context: Context, value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), context.resources.displayMetrics).toInt()

    fun column(context: Context, padding: Int = 16): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        val p = dp(context, padding)
        setPadding(p, p, p, p)
    }

    fun text(context: Context, value: String, size: Float = 14f, color: Int = TEXT, bold: Boolean = false, mono: Boolean = false) =
        TextView(context).apply {
            text = value
            setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
            setTextColor(color)
            typeface = when {
                mono -> Typeface.MONOSPACE
                bold -> Typeface.DEFAULT_BOLD
                else -> Typeface.DEFAULT
            }
            setLineSpacing(0f, 1.2f)
        }

    /** A small grey label above a value. */
    fun label(context: Context, value: String) = text(context, value, 12f, TEXT_3, bold = true).apply {
        setPadding(0, dp(context, 16), 0, dp(context, 4))
    }

    fun box(context: Context, background: Int, border: Int) = GradientDrawable().apply {
        setColor(background)
        setStroke(dp(context, 1), border)
        cornerRadius = dp(context, 6).toFloat()
    }

    fun button(context: Context, value: String, filled: Int?, onClick: () -> Unit) = Button(context).apply {
        text = value
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        setTextColor(if (filled != null) Color.WHITE else TEXT)
        background = box(context, filled ?: Color.WHITE, filled ?: BORDER)
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(0, dp(context, 48), 1f).apply {
            marginEnd = dp(context, 8)
        }
    }

    fun matchWidth() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
}
