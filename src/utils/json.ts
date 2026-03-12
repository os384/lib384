/**
 * Adding a more resilient wrapper around JSON.parse. The 'loc' parameter is typically (file) line number.
 * @internal
 */
export function jsonParseWrapper(str: string | null, loc?: string, reviver?: (this: any, key: string, value: any) => any) {
    while (str && typeof str === 'string') {
      try {
        str = JSON.parse(str, reviver) // handle nesting
      } catch (e) {
        throw new Error(`JSON.parse() error${loc ? ` at ${loc}` : ''}: ${e}\nString (possibly nested) was: ${str}`)
      }
    }
    return str as any
  }
  
  // this is a simple pattern to check if a string is a simple JSON (object or array)
  const simpleJsonPattern = /^\s*[\[\{].*[\]\}]\s*$/;
  
  /**
   * Different version than jsonParseWrapper. Does not throw, and also checks for
   * simple strings (which are not valid JSON) and would return those. Returns
   * null if input is null, or it can't figure out what it is. Used in (low level)
   * messaging contexts.
   * @internal
   */
  export function jsonOrString(str: string | null) {
    if (str === null) return null
    if (typeof str === 'string') {
      if (simpleJsonPattern.test(str)) {
        try {
          str = JSON.parse(str) // handle nesting
          return str as any
        } catch (e) {
          return null
        }
      } else {
        return str as string
      }
    } else {
      return null
    }
  }