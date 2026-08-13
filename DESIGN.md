---
name: PCM
description: 공정 조건을 정밀하게 편집하고 검증 근거를 한 화면에서 추적하는 Drafting Table 작업 환경
colors:
  draft-canvas: "#f7f7f3"
  draft-ink: "#12232a"
  draft-teal: "#196b67"
  draft-teal-hover: "#2f8782"
  draft-teal-subtle: "#dcecea"
  draft-amber: "#d18b2c"
  draft-rule: "#cbd2cf"
  surface: "#ffffff"
  control-border: "#81979e"
  muted: "#52656a"
  success: "#166534"
  success-surface: "#dcfce7"
  warning: "#92400e"
  warning-surface: "#fef3c7"
  error: "#b91c1c"
  error-surface: "#fef2f2"
typography:
  title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.25
  identifier:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.25
rounded:
  none: "0px"
  control: "6px"
  alert: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "{colors.draft-teal}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.draft-ink}"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "6px 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.draft-ink}"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "6px 12px"
---

# Design System: PCM

## Overview

**Creative North Star: “Drafting Table”**

PCM은 공학 도면, 리비전 블록, P&ID 주석 체계에서 가져온 정밀하고 차분한 데스크톱 작업 환경이다. 미색 제도 용지 위에 먹색 정보 구조와 청록색 현재 상태를 얹고, 변경·리비전만 절제된 황동빛으로 표시한다. 데이터가 장식보다 앞서며, 긴 편집 세션에서 좌표와 상태를 놓치지 않는 것이 시각적 개성보다 중요하다.

조건표에서는 Layer 탐색기, 가상화 그리드, 증거 패널이 한 장의 수평 작업면을 이룬다. 일반 관리 화면은 같은 색·타입·상태 문법을 사용하되 조건표의 고밀도 구성을 강제하지 않는다.

**Key Characteristics:**

- 1px 제도선과 평면 표면으로 구조를 드러낸다.
- 청록은 현재 선택과 주요 행동에, amber는 미저장·리비전에만 쓴다.
- Layer·parameter·좌표 식별자는 monospace, 사용자 문구는 system sans로 분리한다.
- 장식보다 실제 데이터, 상태 문구, 키보드 포커스를 우선한다.

## Colors

미색 캔버스와 진한 청록 먹색이 장시간 표 읽기의 기반이며, 강한 색은 상태 의미가 있을 때만 사용한다. 정확한 값은 frontmatter 토큰이 정본이다.

### Primary

- **Drafting Teal:** 현재 Layer, 주요 버튼, 선택된 증거 탭과 밝은 표면 포커스에 사용한다.
- **Drafting Ink:** 집중 헤더, 제목, 표의 주요 텍스트와 강한 hover에 사용한다.

### Secondary

- **Revision Amber:** 미저장 셀, 변경 근거, 리비전 상태에 한정한다.
- **Teal Subtle:** 현재 행과 비파괴 hover의 낮은 강조 표면이다.

### Neutral

- **Draft Canvas:** 앱 배경과 탐색기·인스펙터의 작업면이다.
- **Surface:** 입력, 패널 내부, 그리드 셀처럼 정보를 직접 담는 면이다.
- **Draft Rule:** 표, 탐색기, 패널을 잇는 1px 구조선이다.
- **Muted:** 보조 설명, 카운트, 비활성 정보에 사용한다.

### Named Rules

**The Evidence Color Rule.** 청록은 현재 상태와 행동, amber는 변경 근거, red·warning은 실제 문제에만 사용한다. 색만으로 상태를 전달하지 않고 항상 문구나 구조를 함께 둔다.

## Typography

**Display Font:** 별도 display face를 사용하지 않는다.

**Body Font:** 운영체제 system sans-serif.

**Label/Mono Font:** 운영체제 monospace stack.

**Character:** 화면 문구는 빠르게 읽히는 중립적인 sans를 사용하고, Layer·parameter·측정값은 고정폭 글꼴로 좌표성을 강화한다. 외부 폰트나 런타임 CDN은 사용하지 않는다.

### Hierarchy

- **Title:** 16px, 700. 집중 헤더 제목과 주요 화면 제목.
- **Body:** 14px, 400–500. 설명, 상태, 폼 내용.
- **Label:** 11–12px, 600–700. 도구, 탭, 열 머리글, 상태 카운트.
- **Identifier:** 10–12px monospace. Layer 번호, code, parameter 및 측정 좌표.

### Named Rules

**The Coordinate Type Rule.** monospace는 코드·좌표·측정값에만 사용하며 기술적인 분위기를 내기 위한 장식으로 사용하지 않는다.

## Layout

4px 기반 간격을 사용한다. 일반 컨트롤은 34–36px 높이이고, 조건표의 행은 36px 고정 리듬을 따른다. 일반 화면은 콘텐츠 책임에 맞춘 흐름형 레이아웃을 사용하고, `/projects/:projectId/sheet`는 viewport를 채우는 Focus Shell을 사용한다.

조건표의 기본 구조는 40px 집중 헤더, 자동 높이 도구 영역, 남은 공간 전체를 차지하는 수평 작업면이다. 작업면은 220px Layer 탐색기, `minmax(0, 1fr)` 그리드, 320–520px 가변 증거 패널로 구성한다. 최소 지원 너비는 1024px이며 주 대상은 1440px 이상 데스크톱이다. 모바일 조건표 편집은 지원 범위가 아니다.

**The Unbroken Context Rule.** Layer 선택, 해당 Layer의 그리드, 검증·이력 근거는 같은 화면에서 유지한다. 하단 글로벌 타임라인이나 별도 페이지 이동으로 편집 문맥을 끊지 않는다.

## Elevation & Depth

PCM은 flat-by-default 시스템이다. 구조는 그림자가 아니라 캔버스와 surface의 미세한 톤 차이, 1px rule, 선택된 행의 subtle teal로 구분한다. 모달이나 드로어처럼 실제로 다른 평면에 놓이는 일시적 표면만 기존 공유 컴포넌트의 제한된 elevation을 사용할 수 있다.

**The Structural Rule Rule.** 상시 작업면에는 border와 shadow를 겹치지 않는다. 제도선 하나로 충분한 구조를 만든다.

## Shapes

그리드, 탐색 행, 증거 탭은 직선과 0px radius를 기본으로 한다. 독립 컨트롤은 6px, 알림은 8px radius를 사용한다. pill은 짧은 상태 배지처럼 의미상 캡슐인 작은 요소에만 허용한다. 선택은 2px 포커스/강조선 또는 채워진 teal 상태로 분명히 나타낸다.

## Components

### Buttons

- **Shape:** 기본 6px radius, 조건표의 segmented tab은 직선형.
- **Primary:** Drafting Teal 바탕과 흰 텍스트. hover는 Drafting Ink.
- **Secondary:** 흰 surface, control border, Drafting Ink 텍스트.
- **Focus:** 2px teal outline과 2px offset. 어두운 집중 헤더에서는 밝은 teal을 사용한다.
- **Disabled / Loading:** 동작 불가 커서와 명시적 opacity, loading은 크기를 유지한 spinner와 `aria-busy`를 제공한다.

### Chips

- 필터·상태 chip은 작은 텍스트와 1px border를 사용한다.
- 선택 상태는 teal 채움과 흰 텍스트, 미선택 상태는 surface와 control border를 사용한다.

### Cards / Containers

- 일반 정보 패널만 6–8px radius를 사용할 수 있다.
- 조건표의 navigator, grid, inspector는 카드가 아니라 하나의 연속 작업면이다.
- 중첩 카드와 장식적 shadow는 사용하지 않는다.

### Inputs / Fields

- 흰 surface, 1px control border, 6px radius가 기본이다.
- 조건표의 조밀한 검색 입력은 32px 높이와 0px radius를 사용한다.
- placeholder는 muted 색을 사용하되 본문 대비를 해치지 않는다.
- 오류·비활성 상태는 색과 함께 문구·disabled semantics를 제공한다.

### Navigation

- 전역 화면은 상단 내비게이션을 사용한다.
- 조건표는 40px 집중 헤더와 좌측 Layer 탐색기를 사용한다.
- Layer 목록은 36px 고정 행으로 가상화하고, 선택 행은 teal text와 subtle teal surface로 표시한다.

### Drafting Table Evidence Inspector

우측 증거 패널은 검증·이력·백본 비교를 3분할 tablist로 제공한다. 폭은 320–520px 사이에서 조절·저장되며, 검증과 이력은 항상 현재 Layer 범위를 기본값으로 사용한다. 패널을 닫아 그리드 폭을 회수할 수 있지만 하단 증거 레일은 만들지 않는다.

## Do's and Don'ts

### Do:

- **Do** 데이터 그리드와 현재 좌표를 첫 화면의 주인공으로 유지한다.
- **Do** 잠금·저장·검증 상태를 짧은 한국어 문구와 적절한 ARIA semantics로 함께 표시한다.
- **Do** 1024px, 1440px, 1920px 데스크톱에서 navigator·grid·inspector의 연속성을 확인한다.
- **Do** Layer 검색, 한 번 클릭 이동, 최근 Layer, 키보드 이동과 가상화를 보존한다.
- **Do** `prefers-reduced-motion`과 visible focus를 유지한다.

### Don't:

- **Don't** 조건표 아래에 글로벌 revision ruler나 bottom workbench를 추가한다.
- **Don't** 검증·이력을 현재 Layer 문맥과 분리하거나 색만으로 오류를 표현한다.
- **Don't** 장식적 gradient, glass, 과도한 shadow, 동일 크기 카드 반복으로 작업면을 채운다.
- **Don't** 외부 폰트, 런타임 CDN 또는 제조 폐쇄망에서 사용할 수 없는 네트워크 의존성을 추가한다.
- **Don't** 모바일을 위해 데스크톱 조건표 밀도와 키보드 흐름을 희생한다.
