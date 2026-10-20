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
import { Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const PROTOCOLS = [
  {
    id: 'openai',
    name: 'OpenAI',
    mark: 'O',
    endpoint: '/v1/chat/completions',
    headers: ['Authorization: Bearer $NEW_API_KEY'],
    body: '{\n    "model": "YOUR_MODEL",\n    "messages": [\n      { "role": "user", "content": "Hello!" }\n    ]\n  }',
  },
  {
    id: 'claude',
    name: 'Claude',
    mark: 'C',
    endpoint: '/v1/messages',
    headers: ['x-api-key: $NEW_API_KEY', 'anthropic-version: 2023-06-01'],
    body: '{\n    "model": "YOUR_MODEL",\n    "max_tokens": 1024,\n    "messages": [\n      { "role": "user", "content": "Hello!" }\n    ]\n  }',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    mark: 'G',
    endpoint: '/v1beta/models/YOUR_MODEL:generateContent',
    headers: ['x-goog-api-key: $NEW_API_KEY'],
    body: '{\n    "contents": [{\n      "parts": [{ "text": "Hello!" }]\n    }]\n  }',
  },
  {
    id: 'responses',
    name: 'Responses',
    mark: 'R',
    endpoint: '/v1/responses',
    headers: ['Authorization: Bearer $NEW_API_KEY'],
    body: '{\n    "model": "YOUR_MODEL",\n    "input": "Hello!"\n  }',
  },
] as const

interface GatewayPreviewProps {
  baseUrl: string
}

export function GatewayPreview(props: GatewayPreviewProps) {
  const { t } = useTranslation()

  return (
    <div className='gateway-preview min-w-0'>
      <Tabs defaultValue='openai' className='gap-4'>
        <TabsList
          aria-label={t('API request examples')}
          className='gateway-protocols grid w-full grid-cols-2 gap-2 p-0 group-data-horizontal/tabs:h-auto sm:grid-cols-4'
        >
          {PROTOCOLS.map((protocol) => (
            <TabsTrigger
              key={protocol.id}
              value={protocol.id}
              className='min-w-0 gap-2 rounded-full px-3 py-2 text-xs'
            >
              <span className='gateway-provider-mark' aria-hidden='true'>
                {protocol.mark}
              </span>
              {protocol.name}
            </TabsTrigger>
          ))}
        </TabsList>
        {PROTOCOLS.map((protocol) => {
          const request = [
            `curl "${props.baseUrl}${protocol.endpoint}" \\`,
            ...protocol.headers.map((header) => `  -H "${header}" \\`),
            '  -H "Content-Type: application/json" \\',
            `  -d '${protocol.body}'`,
          ].join('\n')

          return (
            <TabsContent key={protocol.id} value={protocol.id}>
              <div className='gateway-code-card overflow-hidden rounded-2xl border'>
                <div className='flex items-center justify-between gap-3 border-b px-5 py-3'>
                  <span className='text-muted-foreground flex items-center gap-2 text-xs'>
                    <Terminal className='size-4' aria-hidden='true' />
                    {t('Request example')}
                  </span>
                  <CopyButton
                    value={request}
                    aria-label={t('Copy request example')}
                    className='size-8'
                  />
                </div>
                <div className='flex min-w-0 items-start gap-2 border-b px-5 py-3'>
                  <Badge variant='secondary' className='font-mono text-[10px]'>
                    POST
                  </Badge>
                  <code className='text-muted-foreground min-w-0 pt-0.5 text-[11px] break-all'>
                    {protocol.endpoint}
                  </code>
                </div>
                <pre className='gateway-request m-0 min-h-72 overflow-x-auto px-5 py-5 text-xs leading-7'>
                  <code>{request}</code>
                </pre>
                <div className='text-muted-foreground border-t px-5 py-3 text-[11px] leading-relaxed'>
                  {t(
                    'Replace YOUR_MODEL and NEW_API_KEY with a model and API key from this site.'
                  )}
                </div>
              </div>
            </TabsContent>
          )
        })}
      </Tabs>
      <p className='text-muted-foreground mt-4 text-center text-[11px] leading-relaxed'>
        {t(
          'Examples show API formats. Available models depend on site configuration.'
        )}
      </p>
    </div>
  )
}
