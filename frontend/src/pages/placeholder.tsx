import { Construction } from 'lucide-react'

export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-base-200 mb-5">
        <Construction className="h-6 w-6 opacity-30" />
      </div>
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mt-1.5 text-sm opacity-40">Esta sección estará disponible próximamente</p>
    </div>
  )
}
