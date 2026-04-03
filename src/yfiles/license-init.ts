/**
 * Initialise the yFiles 3.0 license.
 *
 * Must complete before any GraphComponent is created.
 * Provide your license data in license.json at the project root
 * (gitignored — copy license.json.example and fill in your key).
 *
 * yFiles 3.0 API: GraphComponent.license = data  (static property)
 */
export async function initLicense(): Promise<void> {
  const [{ GraphComponent }, licenseModule] = await Promise.all([
    import('yfiles') as unknown as Promise<{ GraphComponent: Record<string, unknown> }>,
    import('../../license.json').catch(() => {
      throw new Error(
        'license.json not found.\nCopy license.json.example → license.json and ' +
        'fill in your yFiles evaluation license from https://my.yworks.com/'
      )
    }),
  ])

  const data = (licenseModule as { default?: object }).default ?? licenseModule
  GraphComponent.license = data
}
