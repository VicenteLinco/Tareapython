import * as XLSX from 'xlsx'

export interface ExcelSheet {
  name: string
  headers: string[]
  rows: (string | number | null | undefined)[][]
}

export function exportToExcel(filename: string, sheets: ExcelSheet[]): void {
  const wb = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const data = [sheet.headers, ...sheet.rows]
    const ws = XLSX.utils.aoa_to_sheet(data)
    XLSX.utils.book_append_sheet(wb, ws, sheet.name)
  }
  XLSX.writeFile(wb, `${filename}.xlsx`)
}
