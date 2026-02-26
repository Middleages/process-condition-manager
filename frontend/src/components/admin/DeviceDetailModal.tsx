import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useDeviceLayers, useEnrichDevice, useSyncLayerMasters } from '@/hooks/useDeviceMaster'
import { useToastStore } from '@/stores/useToastStore'
import type { DeviceMaster } from '@/types/deviceMaster'
import { RefreshCw, Sparkles, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

interface DeviceDetailModalProps {
  device: DeviceMaster | null
  open: boolean
  onClose: () => void
  readOnly?: boolean
}

function EnrichmentSection({
  enrichment,
}: {
  enrichment: Record<string, Record<string, unknown>>
}) {
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set())

  const sourceNames = Object.keys(enrichment)

  if (sourceNames.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-2">
        Enrichment 데이터가 없습니다.
      </div>
    )
  }

  const toggleSource = (name: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  return (
    <div className="space-y-1">
      {sourceNames.map((sourceName) => {
        const isExpanded = expandedSources.has(sourceName)
        const fields = enrichment[sourceName]
        const fieldEntries = Object.entries(fields)
        return (
          <div key={sourceName} className="border rounded-md">
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors text-left"
              onClick={() => toggleSource(sourceName)}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0" />
              )}
              <span>{sourceName}</span>
              <Badge variant="outline" className="ml-auto text-xs">
                {fieldEntries.length}
              </Badge>
            </button>
            {isExpanded && (
              <div className="px-3 pb-2">
                {fieldEntries.length === 0 ? (
                  <div className="text-xs text-muted-foreground">데이터 없음</div>
                ) : (
                  <div className="space-y-0.5">
                    {fieldEntries.map(([key, value]) => (
                      <div key={key} className="flex justify-between text-xs">
                        <span className="text-muted-foreground font-mono">{key}</span>
                        <span className="text-foreground ml-2 truncate max-w-[200px]">
                          {value === null ? (
                            <span className="text-muted-foreground italic">null</span>
                          ) : (
                            String(value)
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function DeviceDetailModal({
  device,
  open,
  onClose,
  readOnly = false,
}: DeviceDetailModalProps) {
  const addToast = useToastStore((s) => s.addToast)

  const { data: layers = [], isLoading: layersLoading } = useDeviceLayers(
    open && device ? device.id : null
  )
  const enrichMutation = useEnrichDevice()
  const syncLayerMutation = useSyncLayerMasters()

  const handleEnrich = () => {
    if (!device) return
    enrichMutation.mutate(device.id, {
      onSuccess: (result) => {
        addToast(
          `Enrichment 완료: ${result.fields_enriched.length}개 필드 업데이트${
            result.errors.length > 0 ? `, ${result.errors.length}개 오류` : ''
          }`,
          result.errors.length > 0 ? 'info' : 'success'
        )
      },
      onError: () => {
        addToast('Enrichment 실행 중 오류가 발생했습니다.', 'error')
      },
    })
  }

  const handleSyncLayers = () => {
    syncLayerMutation.mutate(undefined, {
      onSuccess: (result) => {
        addToast(
          `레이어 동기화 완료: ${result.inserted}개 추가, ${result.updated}개 수정`,
          'success'
        )
      },
      onError: () => {
        addToast('레이어 동기화 중 오류가 발생했습니다.', 'error')
      },
    })
  }

  const sortedLayers = [...layers].sort((a, b) => {
    const numA = parseInt(a.layer_id, 10)
    const numB = parseInt(b.layer_id, 10)
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB
    return a.layer_id.localeCompare(b.layer_id)
  })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            디바이스 상세 정보
          </DialogTitle>
        </DialogHeader>

        {device && (
          <div className="space-y-5">
            {/* Device Info */}
            <section>
              <h3 className="text-sm font-semibold mb-2">기본 정보</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">라인: </span>
                  <span className="font-medium">{device.line_name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">제품명: </span>
                  <span className="font-medium">{device.product_name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">공정: </span>
                  <span className="font-medium">{device.process}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Part ID: </span>
                  <span className="font-medium">{device.part_id ?? '--'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">상태: </span>
                  {device.is_active ? (
                    <span className="text-green-700">활성</span>
                  ) : (
                    <span className="text-gray-500">비활성</span>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">동기화: </span>
                  <span className="text-xs">
                    {device.synced_at
                      ? new Date(device.synced_at).toLocaleString('ko-KR')
                      : '--'}
                  </span>
                </div>
              </div>
            </section>

            {/* Enrichment Data */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">Enrichment 데이터</h3>
                {!readOnly && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEnrich}
                    disabled={enrichMutation.isPending}
                  >
                    {enrichMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-1" />
                    )}
                    Enrich
                  </Button>
                )}
              </div>
              <EnrichmentSection enrichment={device.enrichment} />
            </section>

            {/* Layer Table */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">
                  레이어 목록{' '}
                  <Badge variant="outline" className="ml-1">
                    {layers.length}
                  </Badge>
                </h3>
                {!readOnly && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSyncLayers}
                    disabled={syncLayerMutation.isPending}
                  >
                    {syncLayerMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-1" />
                    )}
                    레이어 동기화
                  </Button>
                )}
              </div>

              {layersLoading ? (
                <div className="text-center py-4 text-muted-foreground text-sm">로딩 중...</div>
              ) : sortedLayers.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  연결된 레이어가 없습니다.
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                  <table className="w-full">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium">Layer ID</th>
                        <th className="px-3 py-2 text-left text-xs font-medium">설명</th>
                        <th className="px-3 py-2 text-left text-xs font-medium">Step Seq</th>
                        <th className="px-3 py-2 text-left text-xs font-medium">동기화일시</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {sortedLayers.map((layer) => (
                        <tr key={layer.id} className="hover:bg-muted/50">
                          <td className="px-3 py-2 text-sm font-mono">{layer.layer_id}</td>
                          <td className="px-3 py-2 text-sm">{layer.descript ?? '--'}</td>
                          <td className="px-3 py-2 text-sm font-mono">
                            {layer.step_seq ?? '--'}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {layer.synced_at
                              ? new Date(layer.synced_at).toLocaleString('ko-KR')
                              : '--'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
