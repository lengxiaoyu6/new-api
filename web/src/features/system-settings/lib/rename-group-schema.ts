/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { z } from 'zod'

export function createRenameGroupSchema(
  t: (key: string) => string,
  currentName: string,
  groupNames: string[]
) {
  return z.object({
    name: z.string().superRefine((name, ctx) => {
      if (
        [...name].length < 1 ||
        [...name].length > 50 ||
        name.trim() !== name ||
        /[,\p{Cc}]/u.test(name)
      ) {
        ctx.addIssue({
          code: 'custom',
          message: t(
            'Group names must contain 1 to 50 characters without commas, control characters, or surrounding whitespace'
          ),
        })
      } else if (name === 'default' || name === 'auto') {
        ctx.addIssue({
          code: 'custom',
          message: t(
            'Default, automatic, and previous group names cannot be renamed or reused'
          ),
        })
      } else if (name === currentName || groupNames.includes(name)) {
        ctx.addIssue({
          code: 'custom',
          message: t('The new group name is already in use'),
        })
      }
    }),
  })
}
