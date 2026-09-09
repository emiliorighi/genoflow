/** Prefix a root-absolute public path with Next.js `basePath` when set. */
export function publicUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalized}`
}
