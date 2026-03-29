/*
 * Copyright (C) 2019-2021 Magnusson Institute
 * Copyright (C) 2022-2026 384, Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
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