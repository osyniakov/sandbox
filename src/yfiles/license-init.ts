/**
 * Initialise the yFiles license.
 *
 * This MUST be called before any other yFiles import is used.
 * The license data comes from `license.json` in the project root.
 * That file is gitignored — copy `license.json.example` → `license.json`
 * and fill in your evaluation or commercial license key.
 */
export async function initLicense(): Promise<void> {
  // Dynamic import so that a missing license.json gives a clear error
  // rather than crashing the entire module graph at startup.
  const [{ License }, licenseData] = await Promise.all([
    import('yfiles'),
    import('../../license.json').catch(() => {
      throw new Error(
        'license.json not found. Copy license.json.example → license.json and ' +
        'fill in your yFiles evaluation license from https://my.yworks.com/'
      )
    }),
  ])

  // licenseData is a JSON module; default export is the JSON value
  License.value = (licenseData as { default: object }).default ?? licenseData
}
