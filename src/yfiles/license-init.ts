/**
 * Initialise the yFiles 3.0 license.
 *
 * Must complete before any GraphComponent is created.
 * Provide your license data in license.json at the project root
 * (gitignored — copy license.json.example and fill in your key).
 *
 * yFiles 3.0 uses License.value (same named export as 2.x).
 * Static import ensures we operate on the same module instance used everywhere.
 */
import { License } from 'yfiles'

export async function initLicense(): Promise<void> {
  const licenseModule = await import('../../license.json').catch(() => {
    throw new Error(
      'license.json not found.\nCopy license.json.example → license.json and ' +
      'fill in your yFiles evaluation license from https://my.yworks.com/'
    )
  })

  // Vite wraps JSON dynamic imports in { default: <data> }
  const data = (licenseModule as { default?: object }).default ?? licenseModule
  License.value = data as object
}
