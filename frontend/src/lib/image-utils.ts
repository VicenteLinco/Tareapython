const MAX_DIMENSION = 400
const JPEG_QUALITY = 0.8
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB

export function comprimirImagen(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('El archivo no es una imagen'))
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      reject(new Error('La imagen supera los 5 MB. Elige una imagen más pequeña.'))
      return
    }

    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Error leyendo el archivo'))
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      const img = new Image()
      img.onerror = () => reject(new Error('No se pudo cargar la imagen'))
      img.onload = () => {
        let { width, height } = img

        // Reducir manteniendo proporción
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height = Math.round((height * MAX_DIMENSION) / width)
            width = MAX_DIMENSION
          } else {
            width = Math.round((width * MAX_DIMENSION) / height)
            height = MAX_DIMENSION
          }
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('No se pudo crear el contexto de canvas'))
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        const compressed = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
        resolve(compressed)
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}
