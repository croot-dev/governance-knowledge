# 검증 기록

2026-10-07 기준. 실제 실행 결과만 기록합니다.

- 호스트와 Docker 이미지에서 각각 핵심 통합 테스트 3개 통과: PostgreSQL WASM 엔진(PGlite) + 실제 LanceDB 파일 저장소 사용
- TypeScript 타입 검사와 ESLint 통과 (경고 없음)
- Next.js 프로덕션 빌드 및 Docker 이미지 빌드 통과
- Docker PostgreSQL 17 기동 및 실제 서버 migration 적용 확인
- 실제 Qwen 추론 미실행: GGUF 모델을 다운로드하거나 embedding server를 기동하지 않음
- 사용자 승인 후 실제 PostgreSQL seed 적재 완료: Term 2개, Expression 7개, Rule 2개
- 호스트 LanceDB에 mock 임베딩 인덱싱 완료: 11개 모두 READY
- 실제 목록 API에서 적재 건수와 READY 상태 확인, 검색 API에서 11개 결과 반환 확인
- 사용자가 요청한 웹 서버 종료 완료: 3000 포트 리스너 없음. PostgreSQL은 실행 유지

브라우저 확인: 실제 Chrome, 데스크톱 1440×1000 및 모바일 390×844.

- 목록의 빈 상태, shadcn Dialog 열기·Escape 닫기, 필드 입력·상태 선택 확인
- FORMAT / MASKING / REQUIRED / ENUM / RANGE / CUSTOM condition 폼 전환 확인
- 시맨틱 검색의 mock 안내, 체크박스, 예시 검색어 입력 확인
- 브라우저 JavaScript 오류 없음, 모바일 가로 넘침 없음
- 실제 PostgreSQL에 연결한 목록 API 200, 잘못된 pageSize 요청 400 확인
- 브라우저에서 데이터를 저장하거나 seed를 우회 실행하지 않음

실제 서버에서 seed 생성 → worker → 검색 흐름을 확인했습니다. 브라우저를 통한 수정·삭제 전체 흐름은 별도로 실행하지 않았으며, 해당 정합성은 격리된 통합 테스트에서 검증했습니다.
