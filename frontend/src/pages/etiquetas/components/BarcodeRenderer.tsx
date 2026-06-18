import { useEffect, useRef } from 'react'
import * as bwipjs from 'bwip-js/browser'

interface BarcodeRendererProps {
  type: 'ean13' | 'gs1-128' | 'qrcode'
  value: string
  width?: number
  height?: number
}

export function BarcodeRenderer({ type, value, width = 200, height = 80 }: BarcodeRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current || !value) return
    try {
      bwipjs.toCanvas(canvasRef.current, {
        bcid: type,
        text: value,
        scale: 3,
        height: height / 10,
        width: width / 10,
        includetext: true,
        textxalign: 'center',
      })
    } catch (e) {
      console.error('Barcode error:', e)
    }
  }, [type, value, width, height])

  return <canvas ref={canvasRef} style={{ maxWidth: '100%' }} />
}
