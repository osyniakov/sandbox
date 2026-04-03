/**
 * Initialise the yFiles 3.0 license.
 *
 * Must complete before any GraphComponent is created.
 * Provide your license data in license.json at the project root
 * (gitignored — copy license.json.example and fill in your key).
 *
 * yFiles 3.0 API: GraphComponent.license = data  (static property)
 *
 * GraphComponent is imported statically so we always operate on the
 * same module instance that the rest of the app uses.
 */

// Static import — same module instance used everywhere
import { GraphComponent } from 'yfiles'

export async function initLicense(): Promise<void> {
  // Dynamic import so a missing license.json fails with a clear message
  // rather than a build error
  const licenseModule = await import('../../license.json').catch(() => {
    throw new Error(
      'license.json not found.\nCopy license.json.example → license.json and ' +
      'fill in your yFiles evaluation license from https://my.yworks.com/'
    )
  })

  // Vite wraps JSON dynamic imports in { default: <data> }
  const data = (licenseModule as { default?: object }).default ?? licenseModule

  // Set the license on the GraphComponent class
  ;(GraphComponent as unknown as { license: unknown }).license = data
}
