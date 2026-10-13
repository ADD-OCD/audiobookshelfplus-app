package app.absplus.android.updater

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ApkVerifierTest {
  private val prod = UpdateSource.PRODUCTION_SIGNER_SHA256
  private val other = "0".repeat(64)
  private val newKey = "1".repeat(64)
  private val expect = ApkExpectation("app.absplus.android", 132, setOf(prod))
  private fun facts(pkg: String = "app.absplus.android", vc: Long = 133, debuggable: Boolean = false, signers: List<String> = listOf(prod), lineage: List<String> = emptyList()) =
    ApkFacts(pkg, vc, debuggable, signers, lineage)
  private fun code(f: ApkFacts?) = (ApkVerifier.evaluate(f, expect) as ApkVerdict.Rejected).code

  @Test
  fun aNewerProductionSignedApkIsAccepted() {
    assertEquals(ApkVerdict.Accepted(133, rotatedFromTrusted = false), ApkVerifier.evaluate(facts(), expect))
    assertEquals(ApkVerdict.Accepted(133, rotatedFromTrusted = false), ApkVerifier.evaluate(facts(signers = listOf(prod.uppercase())), expect))
  }

  @Test
  fun unreadablePackagesAndWrongPackagesAreRejected() {
    assertEquals(UpdateErrorCode.INVALID_APK, code(null))
    assertEquals(UpdateErrorCode.WRONG_PACKAGE, code(facts(pkg = "app.absplus.android.debug")))
    assertEquals(UpdateErrorCode.WRONG_PACKAGE, code(facts(pkg = "com.example.other")))
    assertEquals(UpdateErrorCode.INVALID_APK, code(facts(vc = 0)))
  }

  @Test
  fun sameVersionAndDowngradesAreRejected() {
    assertEquals(UpdateErrorCode.NOT_NEWER, code(facts(vc = 132)))
    assertEquals(UpdateErrorCode.NOT_NEWER, code(facts(vc = 131)))
    assertEquals(UpdateErrorCode.NOT_NEWER, code(facts(vc = 1)))
  }

  @Test
  fun versionCodesBeyondTheIntRangeCompareCorrectly() {
    val e = expect.copy(installedVersionCode = Int.MAX_VALUE.toLong())
    assertTrue(ApkVerifier.evaluate(facts(vc = Int.MAX_VALUE.toLong() + 1), e) is ApkVerdict.Accepted)
    assertEquals(UpdateErrorCode.NOT_NEWER, (ApkVerifier.evaluate(facts(vc = Int.MAX_VALUE.toLong()), e) as ApkVerdict.Rejected).code)
  }

  @Test
  fun debuggableUnsignedMultiSignerAndForeignSignedApksAreRejected() {
    assertEquals(UpdateErrorCode.DEBUGGABLE, code(facts(debuggable = true)))
    assertEquals(UpdateErrorCode.UNSIGNED, code(facts(signers = emptyList())))
    assertEquals(UpdateErrorCode.MULTIPLE_SIGNERS, code(facts(signers = listOf(prod, other))))
    assertEquals(UpdateErrorCode.UNTRUSTED_SIGNER, code(facts(signers = listOf(other))))
  }

  @Test
  fun keyRotationIsAcceptedOnlyThroughALineageFromTheTrustedKey() {
    assertEquals(ApkVerdict.Accepted(133, rotatedFromTrusted = true), ApkVerifier.evaluate(facts(signers = listOf(newKey), lineage = listOf(prod, newKey)), expect))
    // A lineage that does not start from the trusted key, or does not end at the signer, proves nothing
    assertEquals(UpdateErrorCode.UNTRUSTED_SIGNER, code(facts(signers = listOf(newKey), lineage = listOf(other, newKey))))
    assertEquals(UpdateErrorCode.UNTRUSTED_SIGNER, code(facts(signers = listOf(newKey), lineage = listOf(newKey, prod))))
    assertEquals(UpdateErrorCode.UNTRUSTED_SIGNER, code(facts(signers = listOf(newKey), lineage = listOf(newKey))))
  }

  @Test
  fun theProductionPinIsThePermanentReleaseCertificate() {
    // docs/release-process.md: C5:40:04:6A:10:FE:8A:97:DD:75:AD:BA:1D:7D:60:E6:9D:69:6B:10:49:2F:F3:81:E1:3F:62:DF:70:2E:B9:D4
    val documented = "C5:40:04:6A:10:FE:8A:97:DD:75:AD:BA:1D:7D:60:E6:9D:69:6B:10:49:2F:F3:81:E1:3F:62:DF:70:2E:B9:D4"
    assertEquals(documented.replace(":", "").lowercase(), UpdateSource.PRODUCTION_SIGNER_SHA256)
    assertEquals(setOf(UpdateSource.PRODUCTION_SIGNER_SHA256), UpdateSource.Production.trustedSignerSha256)
    assertEquals("app.absplus.android", UpdateSource.Production.targetPackage)
    assertEquals("https://api.github.com/repos/ADD-OCD/audiobookshelfplus-app/releases/latest", UpdateSource.Production.latestReleaseUrl)
    assertTrue(!UpdateSource.Production.allowCleartextLoopback && !UpdateSource.Production.isTest && UpdateSource.Production.downloadsEnabled)
  }
}
