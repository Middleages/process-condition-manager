import { useState, useRef } from 'react'
import { Bell } from 'lucide-react'
import { useUnreadCount } from '@/hooks/useAnnouncements'
import AnnouncementDropdown from '@/components/announcement/AnnouncementDropdown'
import AnnouncementDetailModal from '@/components/announcement/AnnouncementDetailModal'
import type { Announcement } from '@/types'

export default function NotificationBell() {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null)
  const bellRef = useRef<HTMLDivElement>(null)

  const { data: unreadData } = useUnreadCount()
  const unreadCount = unreadData?.count ?? 0

  const handleToggleDropdown = () => {
    setIsDropdownOpen((prev) => !prev)
  }

  const handleSelectAnnouncement = (announcement: Announcement) => {
    setIsDropdownOpen(false)
    setSelectedAnnouncement(announcement)
  }

  const handleCloseDetail = () => {
    setSelectedAnnouncement(null)
  }

  const displayCount = unreadCount > 9 ? '9+' : String(unreadCount)

  return (
    <>
      <div ref={bellRef} className="relative">
        <button
          onClick={handleToggleDropdown}
          className="relative p-1.5 rounded-md hover:bg-primary-foreground/20 transition-colors"
          aria-label="공지사항"
        >
          <Bell className="h-4 w-4 text-primary-foreground" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
              {displayCount}
            </span>
          )}
        </button>

        <AnnouncementDropdown
          isOpen={isDropdownOpen}
          onClose={() => setIsDropdownOpen(false)}
          onSelect={handleSelectAnnouncement}
        />
      </div>

      <AnnouncementDetailModal
        isOpen={!!selectedAnnouncement}
        onClose={handleCloseDetail}
        announcement={selectedAnnouncement}
      />
    </>
  )
}
