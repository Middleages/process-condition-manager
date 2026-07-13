import { useEffect, useLayoutEffect } from 'react'

/**
 * 브라우저에서는 commit 직후 동기 게시가 필요한 ref에 layout effect를 쓰고, 서버 렌더에서는
 * 실행할 callback이 없으므로 effect로 낮춰 React의 SSR 경고를 피한다.
 */
export const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect
