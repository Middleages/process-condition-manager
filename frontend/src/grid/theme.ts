/**
 * 조건표 Canvas의 라이브러리 중립 색 계약.
 *
 * 이 파일은 Glide 타입을 알지 않는다. 어댑터만 이 값을 현재 grid library의 Theme으로 옮긴다.
 */
export const GRID_COLORS = {
  ink: '#172f35',
  brand: '#0f766e',
  brandAccent: '#14b8a6',
  brandSubtle: '#ccfbf1',
  canvas: '#f4f7f8',
  surface: '#ffffff',
  border: '#d7e1e5',
  muted: '#52656a',
  success: '#166534',
  successSurface: '#dcfce7',
  warning: '#92400e',
  warningSurface: '#fef3c7',
  error: '#b91c1c',
  errorSurface: '#fef2f2',
} as const
