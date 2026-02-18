import { Download, Loader2 } from 'lucide-react'

interface ExportDownloadButtonProps {
  selectedCount: number
  isDownloading: boolean
  onClick: () => void
}

export function ExportDownloadButton({
  selectedCount,
  isDownloading,
  onClick,
}: ExportDownloadButtonProps) {
  const isDisabled = selectedCount === 0 || isDownloading

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={`
        flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-colors
        ${isDisabled
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
          : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm'
        }
      `}
    >
      {isDownloading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      <span>
        {isDownloading
          ? '다운로드 중...'
          : `전산 출력 다운로드${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
      </span>
    </button>
  )
}
