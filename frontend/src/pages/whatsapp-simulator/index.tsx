import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { 
  MessageCircle, 
  Send, 
  RefreshCw, 
  User, 
  Phone, 
  FileJson, 
  Terminal,
  HelpCircle,
  Clock
} from 'lucide-react'
import api from '@/lib/api'
import { notify } from '@/lib/notify'
import { parseApiError } from '@/lib/api-error'
import type { UsuarioResponse } from '@/types/generated'

interface WebhookLogEntry {
  id: string
  message_id: string
  sender_phone: string
  usuario_id: string | null
  request_body: string
  command_type: string | null
  status: string
  response_body: string | null
  created_at: string
}

// Preset commands for user convenience
const PRESETS = [
  { label: '📦 Consultar Stock', text: 'Hola! ¿Qué stock hay de guantes de nitrilo?' },
  { label: '📥 Registrar Ingreso', text: 'Registrar ingreso de 100 unidades de guantes de nitrilo con lote LN-777 y vencimiento 2028-01-01 en el área 1' },
  { label: '🛒 Crear Solicitud', text: 'Crear solicitud de compra para guantes de nitrilo' },
  { label: '❓ Pregunta General', text: 'Hola, ¿cómo puedo registrar una recepción?' }
]

export default function WhatsappSimulator() {
  const chatEndRef = useRef<HTMLDivElement>(null)
  
  const [selectedPhone, setSelectedPhone] = useState('+56912345678')
  const [customPhone, setCustomPhone] = useState('')
  const [useCustomPhone, setUseCustomPhone] = useState(false)
  const [inputText, setInputText] = useState('')
  const [selectedLog, setSelectedLog] = useState<WebhookLogEntry | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Determine actual active phone
  const activePhone = useCustomPhone ? customPhone : selectedPhone

  // 1. Fetch registered users to populate phone selector
  const { data: usuarios = [], isLoading: loadingUsuarios } = useQuery<UsuarioResponse[]>({
    queryKey: ['usuarios'],
    queryFn: async () => {
      const res = await api.get('/usuarios')
      return res.data
    }
  })

  // Filter users with registered whatsapp phone
  const whatsappUsers = usuarios.filter(u => u.whatsapp_phone)

  // 2. Fetch webhook logs from our new endpoint
  const { data: logs = [], isLoading: loadingLogs, refetch: refetchLogs } = useQuery<WebhookLogEntry[]>({
    queryKey: ['whatsapp-logs'],
    queryFn: async () => {
      const res = await api.get('/webhooks/whatsapp/logs')
      return res.data
    },
    // Refetch periodically if auto-refresh is active
    refetchInterval: autoRefresh ? 3000 : false
  })

  // Scroll chat to bottom when logs or phone selection changes
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, activePhone])

  // 3. Mutation to simulate sending a WhatsApp message
  const sendMutation = useMutation({
    mutationFn: async (messageText: string) => {
      const msgId = `sim_msg_${Date.now()}`
      const payload = {
        event: 'onMessage',
        data: {
          id: msgId,
          body: messageText,
          from: activePhone,
          type: 'chat',
          timestamp: Math.floor(Date.now() / 1000)
        }
      }

      // We call the public webhook endpoint with the mock secret
      return api.post('/webhooks/whatsapp', payload, {
        headers: {
          'X-Webhook-Secret': 'mock_webhook_secret_for_dev'
        }
      })
    },
    onSuccess: () => {
      setInputText('')
      notify.success('Mensaje simulado enviado al webhook')
      // Refresh logs immediately
      refetchLogs()
    },
    onError: (err) => {
      notify.error(parseApiError(err))
    }
  })

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!inputText.trim()) return
    if (!activePhone.trim()) {
      notify.warning('Por favor ingresa o selecciona un número de WhatsApp')
      return
    }
    sendMutation.mutate(inputText)
  }

  const handlePresetClick = (text: string) => {
    setInputText(text)
  }

  // Parse user text from raw JSON request body
  const parseUserMessage = (rawJson: string) => {
    try {
      const parsed = JSON.parse(rawJson)
      if (parsed.data && parsed.data.body) {
        return parsed.data.body
      }
      if (parsed.Body) {
        return parsed.Body
      }
      return rawJson
    } catch {
      return rawJson
    }
  }

  // Generate conversation list for the active phone number from the logs
  const getChatHistory = () => {
    // Filter and sort logs for the selected phone number ascending (oldest first)
    const phoneLogs = logs
      .filter(l => l.sender_phone === activePhone)
      .slice()
      .reverse()

    return phoneLogs.map(log => ({
      id: log.id,
      userMsg: parseUserMessage(log.request_body),
      botMsg: log.response_body,
      status: log.status,
      command: log.command_type,
      time: new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      originalLog: log
    }))
  }

  const chatHistory = getChatHistory()

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col gap-4 overflow-hidden p-1">
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-base-200 bg-base-100 p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-500/10 text-green-500">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-base-content">Simulador de Bot de WhatsApp</h1>
            <p className="text-xs text-base-content/60">Prueba el comportamiento del asistente y la ejecución de comandos IA</p>
          </div>
        </div>
        
        {/* Connection status badge */}
        <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-1 text-xs font-semibold text-success">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
          </span>
          Servidor Activo (8080)
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-10">
        
        {/* CHAT PANEL (Lg: 6 cols) */}
        <div className="flex flex-col rounded-xl border border-base-200 bg-base-100 shadow-sm lg:col-span-6 overflow-hidden">
          
          {/* Chat Header / Configuration */}
          <div className="flex flex-col gap-3 border-b border-base-200 p-4 bg-base-50">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-semibold text-base-content/70 uppercase tracking-wider">
                Simular como usuario:
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={useCustomPhone}
                  onChange={(e) => setUseCustomPhone(e.target.checked)}
                  id="chk-custom-phone"
                />
                <label htmlFor="chk-custom-phone" className="text-xs cursor-pointer select-none">
                  Número personalizado
                </label>
              </div>
            </div>

            {useCustomPhone ? (
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Phone className="absolute left-3 top-2.5 h-4 w-4 text-base-content/40" />
                  <input
                    type="text"
                    className="input input-sm input-bordered w-full pl-9"
                    placeholder="+56912345678"
                    value={customPhone}
                    onChange={(e) => setCustomPhone(e.target.value)}
                  />
                </div>
                <button 
                  className="btn btn-sm btn-ghost text-xs" 
                  onClick={() => setCustomPhone('+56912345678')}
                >
                  Usar Admin
                </button>
              </div>
            ) : (
              <div className="relative">
                <User className="absolute left-3 top-2.5 h-4 w-4 text-base-content/40" />
                <select
                  className="select select-sm select-bordered w-full pl-9 text-xs"
                  value={selectedPhone}
                  onChange={(e) => setSelectedPhone(e.target.value)}
                  disabled={loadingUsuarios}
                >
                  <option value="">-- Selecciona un Usuario Registrado --</option>
                  {whatsappUsers.length === 0 ? (
                    <option value="+56912345678">Administrador (+56912345678)</option>
                  ) : (
                    whatsappUsers.map((u) => (
                      <option key={u.id} value={u.whatsapp_phone || ''}>
                        {u.nombre} ({u.whatsapp_phone}) - {u.rol}
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}
          </div>

          {/* Chat Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-base-100/50">
            {chatHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8 opacity-60">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-base-200 mb-3 text-base-content/40">
                  <HelpCircle className="h-6 w-6" />
                </div>
                <p className="text-sm font-semibold">No hay mensajes recientes en esta simulación</p>
                <p className="text-xs text-base-content/60 max-w-xs mt-1">
                  Escribe un mensaje abajo o selecciona un preset para iniciar la conversación con la IA.
                </p>
              </div>
            ) : (
              chatHistory.map((chat) => (
                <div key={chat.id} className="space-y-2">
                  
                  {/* User bubble */}
                  <div className="chat chat-end">
                    <div className="chat-bubble chat-bubble-primary text-sm max-w-[85%] break-words">
                      {chat.userMsg}
                    </div>
                    <div className="chat-footer opacity-65 text-[10px] mt-1 flex items-center gap-1.5">
                      <span>Tú</span>
                      <span>•</span>
                      <span>{chat.time}</span>
                    </div>
                  </div>

                  {/* Bot bubble */}
                  <div className="chat chat-start">
                    <div className="chat-bubble bg-base-200 border border-base-300 text-base-content text-sm max-w-[85%] break-words relative">
                      {chat.botMsg ? (
                        <div>{chat.botMsg}</div>
                      ) : (
                        <div className="flex items-center gap-2 py-1 opacity-70">
                          <span className="loading loading-dots loading-xs"></span>
                          <span>Procesando con IA...</span>
                        </div>
                      )}

                      {/* Command & Status tags inside bubble footer */}
                      {(chat.command || chat.status) && (
                        <div className="mt-2 pt-1.5 border-t border-base-300 flex flex-wrap gap-1 items-center">
                          {chat.command && (
                            <span className="badge badge-xs bg-indigo-500/10 text-indigo-500 font-semibold border-none">
                              Comando: {chat.command}
                            </span>
                          )}
                          <span className={`badge badge-xs font-semibold border-none ${
                            chat.status === 'SUCCESS' ? 'bg-success/10 text-success' :
                            chat.status === 'UNAUTHORIZED' ? 'bg-warning/10 text-warning' :
                            'bg-error/10 text-error'
                          }`}>
                            Status: {chat.status}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="chat-footer opacity-65 text-[10px] mt-1 flex items-center gap-1.5">
                      <span>Asistente IA</span>
                      <span>•</span>
                      <span>{chat.time}</span>
                      <span>•</span>
                      <button 
                        onClick={() => setSelectedLog(chat.originalLog)}
                        className="link link-hover text-primary font-semibold"
                      >
                        Inspeccionar
                      </button>
                    </div>
                  </div>

                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Preset Buttons */}
          <div className="p-3 border-t border-base-200 bg-base-50 flex flex-wrap gap-1.5 items-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-base-content/50 mr-1">
              Presets:
            </span>
            {PRESETS.map((preset, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handlePresetClick(preset.text)}
                className="btn btn-xs btn-outline btn-ghost text-[10px] rounded-full px-2.5 py-0.5"
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Message Input Box */}
          <form onSubmit={handleSend} className="p-4 border-t border-base-200 bg-base-100 flex gap-2">
            <input
              type="text"
              className="input input-bordered w-full flex-1 text-sm"
              placeholder="Pregúntale al bot de WhatsApp (ej. ¿Qué stock hay de guantes?)..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={sendMutation.isPending}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={sendMutation.isPending || !inputText.trim()}
            >
              {sendMutation.isPending ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </form>

        </div>

        {/* DEVELOPER LOG PANEL (Lg: 4 cols) */}
        <div className="flex flex-col rounded-xl border border-base-200 bg-base-100 shadow-sm lg:col-span-4 overflow-hidden">
          
          {/* Header */}
          <div className="flex items-center justify-between border-b border-base-200 p-4 bg-base-50">
            <div className="flex items-center gap-2">
              <Terminal className="h-4.5 w-4.5 text-primary" />
              <span className="font-semibold text-sm">Consola de Webhooks</span>
            </div>
            
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="toggle toggle-primary toggle-xs"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  id="chk-auto-refresh"
                />
                <label htmlFor="chk-auto-refresh" className="text-[10px] font-semibold cursor-pointer select-none">
                  Auto
                </label>
              </div>
              
              <button
                onClick={() => refetchLogs()}
                className="btn btn-xs btn-ghost btn-circle"
                disabled={loadingLogs}
                title="Actualizar Logs"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Logs List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-base-900 text-base-content/90">
            {logs.length === 0 ? (
              <div className="text-center p-8 opacity-50 text-xs">
                No se han registrado transacciones de webhook todavía.
              </div>
            ) : (
              logs.map((log) => {
                const isActiveLog = selectedLog?.id === log.id
                const isMyPhone = log.sender_phone === activePhone
                const time = new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

                return (
                  <div
                    key={log.id}
                    onClick={() => setSelectedLog(isActiveLog ? null : log)}
                    className={`p-3 rounded-lg border text-xs cursor-pointer transition-all duration-200 ${
                      isActiveLog 
                        ? 'bg-base-200 border-primary shadow-sm' 
                        : 'bg-base-50/50 hover:bg-base-50 border-base-200'
                    } ${isMyPhone ? 'ring-1 ring-primary/20' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${
                          log.status === 'SUCCESS' ? 'bg-success' :
                          log.status === 'UNAUTHORIZED' ? 'bg-warning' :
                          'bg-error'
                        }`} />
                        <span className="font-semibold text-base-content/90 font-mono text-[10px]">
                          {log.sender_phone}
                        </span>
                      </div>
                      <span className="text-[9px] text-base-content/50 font-mono flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" /> {time}
                      </span>
                    </div>

                    <div className="font-mono text-[10px] truncate text-base-content/70">
                      Msg: {parseUserMessage(log.request_body)}
                    </div>

                    {/* Badge details */}
                    <div className="mt-2 flex flex-wrap gap-1 justify-between items-center text-[9px] text-base-content/50">
                      <div className="flex gap-1">
                        {log.command_type && (
                          <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-500 font-mono font-bold">
                            {log.command_type}
                          </span>
                        )}
                        <span className={`px-1.5 py-0.5 rounded font-mono font-bold uppercase ${
                          log.status === 'SUCCESS' ? 'bg-success/10 text-success' :
                          log.status === 'UNAUTHORIZED' ? 'bg-warning/10 text-warning' :
                          'bg-error/10 text-error'
                        }`}>
                          {log.status}
                        </span>
                      </div>
                      <span className="text-[8px] font-mono text-base-content/40">
                        ID: {log.message_id.substring(0, 12)}...
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Selected Log Inspector Panel (Sliding Drawer / Fixed Height Panel) */}
          {selectedLog && (
            <div className="border-t border-base-200 bg-base-50 p-4 max-h-[50%] overflow-y-auto space-y-3 shadow-lg">
              <div className="flex items-center justify-between border-b border-base-200 pb-2">
                <span className="font-semibold text-xs flex items-center gap-1.5">
                  <FileJson className="h-4 w-4 text-primary" />
                  Detalles del Webhook Log
                </span>
                <button 
                  className="btn btn-xs btn-circle btn-ghost" 
                  onClick={() => setSelectedLog(null)}
                >
                  ✕
                </button>
              </div>

              <div className="space-y-2 font-mono text-[10px] break-all">
                <div>
                  <span className="font-bold text-base-content/50">ID Log:</span>
                  <p className="bg-base-200 p-1 rounded mt-0.5 select-all">{selectedLog.id}</p>
                </div>
                <div>
                  <span className="font-bold text-base-content/50">ID Mensaje:</span>
                  <p className="bg-base-200 p-1 rounded mt-0.5 select-all">{selectedLog.message_id}</p>
                </div>
                <div>
                  <span className="font-bold text-base-content/50">Teléfono:</span>
                  <p className="bg-base-200 p-1 rounded mt-0.5">{selectedLog.sender_phone}</p>
                </div>
                <div>
                  <span className="font-bold text-base-content/50">Comando:</span>
                  <p className="bg-base-200 p-1 rounded mt-0.5">{selectedLog.command_type || 'Ninguno'}</p>
                </div>
                <div>
                  <span className="font-bold text-base-content/50">Estado:</span>
                  <p className={`p-1 rounded mt-0.5 font-bold ${
                    selectedLog.status === 'SUCCESS' ? 'text-success bg-success/5' :
                    selectedLog.status === 'UNAUTHORIZED' ? 'text-warning bg-warning/5' :
                    'text-error bg-error/5'
                  }`}>{selectedLog.status}</p>
                </div>
                <div>
                  <span className="font-bold text-base-content/50">Payload Recibido (Request Body):</span>
                  <pre className="bg-base-200 p-2 rounded mt-0.5 overflow-x-auto whitespace-pre-wrap max-h-36">
                    {JSON.stringify(JSON.parse(selectedLog.request_body), null, 2)}
                  </pre>
                </div>
                <div>
                  <span className="font-bold text-base-content/50">Respuesta Generada (Response Body):</span>
                  <p className="bg-base-200 p-2 rounded mt-0.5 whitespace-pre-wrap max-h-36 overflow-y-auto">
                    {selectedLog.response_body || '<em>Ninguna o vacía</em>'}
                  </p>
                </div>
              </div>
            </div>
          )}

        </div>

      </div>
    </div>
  )
}
