package com.consequenceos.edgeguard.approver

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Checks ReceiptCheck against receipts made by the TypeScript code
 * (scripts/write-receipt-vectors.ts; src/ops/receiptVectors.test.ts holds the same file to the
 * TypeScript side). If the phone wrote canonical JSON differently, it would refuse genuine
 * receipts; if it skipped a check, it would accept a tampered one.
 */
class ReceiptCheckTest {
    private val file: JSONObject = JSONObject(
        javaClass.classLoader!!.getResourceAsStream("receipt-vectors.json")!!.bufferedReader().readText(),
    )

    /** Firestore hands the app Maps, Lists, Longs and Doubles; JSON parsing gives the same shapes. */
    private fun plain(value: Any?): Any? = when (value) {
        JSONObject.NULL -> null
        is JSONObject -> value.keys().asSequence().associateWith { plain(value.get(it)) }
        is JSONArray -> (0 until value.length()).map { plain(value.get(it)) }
        is Int -> value.toLong()
        else -> value
    }

    @Suppress("UNCHECKED_CAST")
    private fun map(value: Any?) = plain(value) as Map<String, Any?>

    private fun check(request: JSONObject): ReceiptCheck.Result {
        val runs = file.getJSONObject("runs")
        val key = if (runs.has(request.getString("runId"))) map(runs.getJSONObject(request.getString("runId")).get("publicKey")) else null
        return ReceiptCheck.check(request.getString("receiptId"), map(request.get("receipt")), request.getString("signature"), key)
    }

    @Test
    fun writesCanonicalJsonByteForByteAsJavaScriptDoes() {
        val cases = file.getJSONArray("canonical")
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            assertEquals("canonical case $i", case.getString("json"), ReceiptCheck.canonicalJson(plain(case.get("value"))))
        }
    }

    @Test
    fun decidesEveryVectorAsTheTypeScriptCodeDoes() {
        val vectors = file.getJSONArray("vectors")
        assertTrue(vectors.length() >= 7)
        for (i in 0 until vectors.length()) {
            val vector = vectors.getJSONObject(i)
            val name = vector.getString("name")
            val expect = vector.getJSONObject("expect")
            when (val result = check(vector.getJSONObject("request"))) {
                is ReceiptCheck.Result.Verified -> {
                    assertTrue("$name should be refused, but was verified", expect.getBoolean("verified"))
                    assertEquals(name, expect.getString("tool"), result.call.tool)
                }
                is ReceiptCheck.Result.Refused -> {
                    if (expect.getBoolean("verified")) fail("$name should be verified, but was refused: ${result.why}")
                    assertTrue("$name: \"${result.why}\" should mention \"${expect.getString("why")}\"", result.why.contains(expect.getString("why")))
                }
            }
        }
    }

    @Test
    fun showsTheSignedCallNotTheUnsignedCopiesBesideIt() {
        val vectors = file.getJSONArray("vectors")
        val decoy = (0 until vectors.length()).map { vectors.getJSONObject(it) }.first { it.getString("name") == "unsigned copies say something else" }
        val request = decoy.getJSONObject("request")
        assertEquals("read_ticket", request.getString("tool"))

        val call = (check(request) as ReceiptCheck.Result.Verified).call
        val receipt = map(request.get("receipt"))
        val toolCall = receipt["toolCall"] as Map<*, *>
        val proposal = receipt["proposal"] as Map<*, *>
        assertEquals("disable_user", call.tool)
        assertEquals(toolCall["args"], call.args)
        assertEquals(proposal["context"], call.reason)
        assertEquals("confidential", call.sensitivity)
        assertEquals((receipt["decision"] as Map<*, *>)["rationale"], call.rationale)
        assertEquals(receipt["digest"], call.digest)
    }

    @Test
    fun signsOnlyWhatItVerified() {
        val vectors = file.getJSONArray("vectors")
        val genuine = vectors.getJSONObject(0).getJSONObject("request")
        val call = (check(genuine) as ReceiptCheck.Result.Verified).call
        val message = Store.message(call, approve = true, decidedAt = "2026-11-19T10:00:00.000Z")
        assertEquals("edge-guard/approval:${genuine.getString("receiptId")}:${call.digest}:mei.lin:2026-11-19T10:00:00.000Z", message)
    }

    @Test
    fun writesNumbersAsJavaScriptDoes() {
        val cases = mapOf(
            0.1 to "0.1", 1e21 to "1e+21", 1e20 to "100000000000000000000", 1e-7 to "1e-7", 0.000001 to "0.000001",
            -2.5e-8 to "-2.5e-8", 100.0 to "100", 1.0 / 3 to "0.3333333333333333", 5e-324 to "5e-324",
            -0.0 to "0", 123.456 to "123.456", 1.7976931348623157e308 to "1.7976931348623157e+308",
            Double.NaN to "null", Double.POSITIVE_INFINITY to "null",
        )
        for ((value, expected) in cases) assertEquals("$value", expected, ReceiptCheck.jsNumber(value))
        assertEquals("482", ReceiptCheck.jsNumber(482L))
    }

    @Test
    fun refusesWhatJsonCannotHold() {
        val receipt = map(file.getJSONArray("vectors").getJSONObject(0).getJSONObject("request").get("receipt")).toMutableMap()
        receipt["proposal"] = mapOf("when" to java.util.Date())
        val result = ReceiptCheck.check(receipt["id"] as String, receipt, "00".repeat(64), emptyMap())
        assertTrue(result is ReceiptCheck.Result.Refused && result.why.contains("cannot check"))
    }

    @Test
    fun rejectsMalformedSignaturesAndKeys() {
        val key = map(file.getJSONObject("runs").let { it.getJSONObject(it.keys().next()) }.get("publicKey"))
        assertFalse(ReceiptCheck.verify(key, "message", "zz".repeat(64)))
        assertFalse(ReceiptCheck.verify(key, "message", "00"))
        assertFalse(ReceiptCheck.verify(key + ("crv" to "P-384"), "message", "00".repeat(64)))
        assertFalse(ReceiptCheck.verify(emptyMap(), "message", "00".repeat(64)))
    }
}
