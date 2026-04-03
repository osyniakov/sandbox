/**
 * Initialise the yFiles license.
 *
 * This MUST complete before any GraphComponent is created.
 * The license data comes from `license.json` in the project root.
 * That file is gitignored — copy `license.json.example` → `license.json`
 * and fill in your yFiles evaluation or commercial license data.
 *
 * yFiles 3.0 changed the license API:
 *   - 2.x: License.value = data   (named export from 'yfiles')
 *   - 3.0: GraphComponent.license = data  (static property)
 * We try both so the code works on either version.
 */
export async function initLicense(): Promise<void> {
  const [yfiles, licenseData] = await Promise.all([
    import('yfiles'),
    import('../../license.json').catch(() => {
      throw new Error(
        'license.json not found. Copy license.json.example → license.json and ' +
        'fill in your yFiles evaluation license from https://my.yworks.com/'
      )
    }),
  ])

  // JSON module: actual data is on .default
  const data = (licenseData as { default: object }).default ?? licenseData

  const yf = yfiles as Record<string, unknown>

  // yFiles 3.0: GraphComponent.license (static property)
  if (yf.GraphComponent && typeof yf.GraphComponent === 'function') {
    const GC = yf.GraphComponent as Record<string, unknown>
    if ('license' in GC) {
      GC.license = data
    }
  }

  // yFiles 2.x: License.value
  if (yf.License && typeof yf.License === 'object') {
    const lic = yf.License as Record<string, unknown>
    if ('value' in lic) {
      lic.value = data
    }
  }
}
