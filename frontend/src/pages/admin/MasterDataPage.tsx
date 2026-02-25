import { useState } from 'react'
import { useAuthStore } from '@/stores/useAuthStore'
import { canWrite } from '@/lib/permissions'
import type { UserRole } from '@/types/user'
import { LineManagementPanel } from '@/components/admin/LineManagementPanel'
import { ProductManagementPanel } from '@/components/admin/ProductManagementPanel'
import { ColumnMetadataPanel } from '@/components/admin/ColumnMetadataPanel'
import { CategoryManagementPanel } from '@/components/admin/CategoryManagementPanel'
import { EquipmentManagementPanel } from '@/components/admin/EquipmentManagementPanel'

type Tab = 'lines' | 'products' | 'columns' | 'categories' | 'equipments'

const tabList: { id: Tab; label: string }[] = [
  { id: 'lines', label: 'Lines' },
  { id: 'products', label: 'Products' },
  { id: 'columns', label: 'Columns' },
  { id: 'categories', label: 'Categories' },
  { id: 'equipments', label: 'Equipments' },
]

export default function MasterDataPage() {
  const [activeTab, setActiveTab] = useState<Tab>('lines')
  const userRoles = useAuthStore((s) => s.user?.roles) as UserRole[] | undefined

  // 마스터 데이터는 operations 카테고리 -> admin 역할만 쓰기 가능
  const readOnly = !canWrite(userRoles, 'operations')

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-6">마스터 데이터 관리</h1>

      {/* Internal Sub-tabs */}
      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
        {tabList.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'lines' && <LineManagementPanel readOnly={readOnly} />}
      {activeTab === 'products' && <ProductManagementPanel readOnly={readOnly} />}
      {activeTab === 'columns' && <ColumnMetadataPanel readOnly={readOnly} />}
      {activeTab === 'categories' && <CategoryManagementPanel readOnly={readOnly} />}
      {activeTab === 'equipments' && <EquipmentManagementPanel readOnly={readOnly} />}
    </div>
  )
}
