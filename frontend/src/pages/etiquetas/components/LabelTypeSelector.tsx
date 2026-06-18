interface Props {
  value: 'presentacion' | 'lote'
  onChange: (v: 'presentacion' | 'lote') => void
}

export function LabelTypeSelector({ value, onChange }: Props) {
  return (
    <div className="flex gap-2">
      {(['presentacion', 'lote'] as const).map((t) => (
        <button
          key={t}
          className={`btn btn-sm ${value === t ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => onChange(t)}
        >
          {t === 'presentacion' ? 'Presentación' : 'Lote'}
        </button>
      ))}
    </div>
  )
}
