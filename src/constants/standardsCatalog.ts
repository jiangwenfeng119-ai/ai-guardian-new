import type { Standard } from '../types';

/** 与「合规标准」页一致；新建评估任务下拉与全应用 Standard 列表均由此派生 */
export interface StandardCatalogEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  items: number;
  type: string;
  color: 'blue' | 'indigo' | 'purple' | 'amber';
}

/** 法律法规 / 标准库展示版本号（与「查看最新同步」文案一致） */
export const LEGAL_SYNC_CATALOG_VERSION = '4.2';

export const STANDARDS_CATALOG: StandardCatalogEntry[] = [
  {
    id: 'djbh-l3',
    name: '等保 2.0 (三级)',
    version: 'GB/T 22239-2019',
    description: '网络安全等级保护 2.0 第三级通用安全要求',
    items: 211,
    type: '国家标准',
    color: 'blue',
  },
  {
    id: 'iso27001',
    name: 'ISO/IEC 27001:2022',
    version: '2022',
    description: '信息安全管理体系 (ISMS) 国际标准',
    items: 114,
    type: '国际标准',
    color: 'indigo',
  },
  {
    id: 'iso27701',
    name: 'ISO/IEC 27701:2019',
    version: '2019 PIMS',
    description: '在 ISO/IEC 27001 基础上扩展的隐私信息管理体系 (PIMS)',
    items: 147,
    type: '国际标准',
    color: 'purple',
  },
  {
    id: 'gdpr',
    name: 'GDPR (欧盟通用数据保护条例)',
    version: 'Regulation (EU) 2016/679',
    description: '欧盟个人数据保护与处理活动合规要求',
    items: 99,
    type: '法规',
    color: 'amber',
  },
  {
    id: 'djbh-l2',
    name: '等保 2.0 (二级)',
    version: 'GB/T 22239-2019',
    description: '网络安全等级保护 2.0 第二级通用安全要求',
    items: 135,
    type: '国家标准',
    color: 'blue',
  },
];

export function catalogEntryToAppStandard(entry: StandardCatalogEntry): Standard {
  return {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    description: entry.description,
    categories: [],
  };
}

export const APP_STANDARDS: Standard[] = STANDARDS_CATALOG.map(catalogEntryToAppStandard);

export const STORAGE_KEY_CUSTOM_STANDARDS = 'ai_guardian_custom_standards_v1';

export function loadCustomStandardsFromStorage(): StandardCatalogEntry[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_STANDARDS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is StandardCatalogEntry =>
        Boolean(x && typeof (x as StandardCatalogEntry).id === 'string' && typeof (x as StandardCatalogEntry).name === 'string')
    );
  } catch {
    return [];
  }
}

export function saveCustomStandardsToStorage(entries: StandardCatalogEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_CUSTOM_STANDARDS, JSON.stringify(entries));
  } catch {
    /* ignore quota */
  }
}
