export function isImageIcon(icon: string | null | undefined): icon is string {
  return !!icon && /^https?:\/\//.test(icon)
}

export function GroupIcon({ icon }: { icon: string | null | undefined }) {
  if (!icon) return null
  return isImageIcon(icon)
    ? <img className="group-icon group-logo" src={icon} alt="" loading="lazy" />
    : <span className="group-icon">{icon}</span>
}

// Scale to max 96px and re-encode as PNG so uploads stay tiny.
export async function resizeLogo(file: File, max = 96): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * scale))
  canvas.height = Math.max(1, Math.round(bmp.height * scale))
  canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image conversion failed'))), 'image/png'))
}
