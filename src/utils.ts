const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export function randomString() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((x) => chars[x % chars.length])
    .join('')
}

export function once<T extends Record<string, () => unknown>, R = { [K in keyof T]: Awaited<ReturnType<T[K]>> }>(
  ctx: DurableObjectState,
  structure: T,
): R {
  const state = {} as R

  // Before any events are delivered, we create the state
  ctx.blockConcurrencyWhile(async () => {
    await Promise.all(
      Object.entries(structure).map(async ([key, generator]) => {
        let value = await ctx.storage.get(key)
        console.log(`Read ${value}`)
        if (!value) {
          value = await generator()
          console.log(`Generated ${value}`)
          ctx.storage.put(key, value)
        }
        state[key as keyof R] = value as any
      }),
    )
  })

  return state
}

export async function getCurrentColo() {
  // Thanks, https://github.com/helloimalastair/where-durableobjects-live/blob/main/src/DO.ts
  const response = await fetch('https://www.cloudflare.com/cdn-cgi/trace')
  const body = await response.text()
  return (body.match(/^colo=(.+)/m) as string[])[1]
}
