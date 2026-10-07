# 데이터 거버넌스 관리 MVP 구현

당신은 시니어 풀스택/플랫폼 엔지니어다. 아래 요구사항에 따라 **실행 가능한 데이터 거버넌스 관리 MVP를 설계하고 구현하라.** 설계 문서만 작성하고 끝내지 말고, 로컬 실행과 검증까지 완료하라.

목표는 표준 용어와 표현, 규칙을 관리하고 향후 AI 문서 분석 컴포넌트가 이를 검색할 수 있도록 하는 것이다. 확장 지점은 인터페이스로 확보하되, MVP에 필요하지 않은 인프라나 범용 프레임워크를 미리 구현하지 않는다.

## 1. 범위와 우선순위

필수 구현:

- Term / Expression / Rule CRUD 및 관계 관리
- 관리 UI와 REST API
- PostgreSQL 원본 저장
- 임베딩 생성 및 Vector Index 동기화
- 원본 데이터를 반환하는 Semantic Search API와 검색 UI
- 로컬 실행 환경, migration, seed, README

현재 범위에서 제외:

- 문서 업로드·파싱 및 Expression Detection 엔진
- Rule Evaluation 엔진과 자동 위반 판정
- 생성형 LLM 연동
- Graph DB, 메시지 브로커, 마이크로서비스 분리
- 인증·권한, 멀티테넌시, 전체 변경 이력 관리

인증 없는 로컬 개발용 MVP임을 README에 명시한다. 기존 프로젝트에 인증이 있으면 유지한다.

향후 활용 흐름은 다음과 같다. 이번 구현은 이 흐름에 필요한 거버넌스 데이터와 검색 기능을 제공한다.

```text
Document → Expression Detection → Term Resolution → Related Rule Resolution → Rule Evaluation
```

충돌하는 선택지가 있으면 **데이터 정합성 → 실행 가능성 → 구현 단순성 → 확장성** 순서로 판단한다.

## 2. 기술 스택과 구현 원칙

- Next.js App Router + TypeScript + shadcn/ui
- API는 Route Handler로 구현
- PostgreSQL을 유일한 Source of Truth로 사용
- ORM, UI 라이브러리, 패키지 관리자는 기존 프로젝트 관례를 따른다. 없다면 최소 구성으로 선택하고 README에 기록한다.
- Vector Store는 PostgreSQL 원본에서 재생성할 수 있는 파생 검색 인덱스다.

Vector Store는 LanceDB를 사용한다. 패키지 관리자는 pnpm을 사용한다. 선택 전에 실제 임베딩 차원과 해당 저장소의 인덱스 제약을 확인한다. in-memory adapter는 테스트용으로만 허용한다.

다음 경계를 유지하되, 단순 CRUD를 위해 불필요한 계층이나 추상 클래스를 만들지 않는다.

```text
UI / Route Handler → Application Service → Repository / Provider 인터페이스
                                              ↑
                                  Infrastructure 구현체
```

예시 디렉터리:

```text
src/
  app/                 # UI 및 API 진입점
  components/          # 공통 UI
  domain/              # 타입과 도메인 제약
  application/         # CRUD, 검색, 인덱싱 서비스
  infrastructure/
    db/
    embedding/
    vector-store/
```

API handler에서 SQL, 임베딩 호출, 인덱스 갱신을 한꺼번에 처리하지 않는다. 특정 Vector DB SDK나 Qwen 호출 코드는 Infrastructure 밖으로 노출하지 않는다.

## 3. 도메인과 관계

공통 필드:

- `id`: UUID. 아래 seed 이름은 설명용이며 실제 식별자로 사용하지 않는다.
- `status`: `DRAFT | ACTIVE | INACTIVE | DEPRECATED`
- `version`: 생성 시 1, 수정 시 증가. MVP에서는 전체 버전 이력을 저장하지 않는다.
- `createdAt`, `updatedAt`, `deletedAt`: UTC 기준. `deletedAt`은 soft delete에 사용한다.

### Term

필수 필드: `name`, `definition`, `domain` 및 공통 필드.

- 삭제되지 않은 Term의 이름은 동일 domain 안에서 고유하다.
- 비교용 문자열은 Unicode NFKC 정규화, 앞뒤 공백 제거, 연속 공백 축약, 영문 소문자화를 적용한다. 표시용 원문은 유지한다.
- `domain`은 별도 엔티티 없이 비어 있지 않은 문자열 코드로 관리한다.

### Expression

필수 필드: `termId`, `text`, `type` 및 공통 필드.

- Expression N : 1 Term. `termId`는 PostgreSQL 외래 키로 관리한다.
- `type`: `ALIAS | ABBREVIATION | TRANSLATION | OTHER`
- 동일 Term 안에서 삭제되지 않은 정규화된 text의 중복은 금지한다.
- 서로 다른 Term에는 같은 표현을 허용한다. 검색 단계에서 이를 자동으로 하나의 Term으로 확정하지 않는다.
- domain은 연결 Term에서 유도하며 원본 필드로 중복 저장하지 않는다.

### Rule

필수 필드: `name`, `description`, `ruleType`, `termId`, `scope`, `condition`, `action`, `priority` 및 공통 필드.

- MVP에서는 Rule N : 1 Term으로 제한한다. 각 Rule은 하나의 Term에 연결한다.
- 임의의 `target.type / target.id` JSON 대신 `termId` 외래 키로 참조 무결성을 보장한다. 다중 대상이나 다른 대상 유형은 향후 확장 사항이다.
- `ruleType`: `FORMAT | MASKING | REQUIRED | ENUM | RANGE | PROHIBITED | RELATION | CUSTOM`
- `scope`, `condition`, `action`은 JSONB를 사용하되 서버에서 구조를 검증한다.
- `scope`는 외부 문서 여부 등 적용 맥락을 표현하며 실제 적용 판정은 하지 않는다. 검색 domain은 연결 Term에서 유도한다.
- `priority`는 정수이며 높은 값이 우선한다. 검색 유사도와는 별개다.
- FORMAT, MASKING, REQUIRED, ENUM, RANGE는 명시적인 입력 스키마와 폼을 제공한다. 나머지는 JSON editor를 허용한다.
- condition과 action은 저장·조회만 한다. 정규식 등 사용자 규칙을 실제 문서에 실행하지 않는다.

예시:

```json
{
  "name": "고객번호 형식 검증",
  "description": "고객번호는 CUST- 접두사 뒤에 숫자 10자리가 오는 형식이어야 한다.",
  "ruleType": "FORMAT",
  "termId": "<연결 Term의 UUID>",
  "scope": {},
  "condition": { "operator": "regex", "pattern": "^CUST-[0-9]{10}$" },
  "action": { "onViolation": "REPORT", "severity": "MEDIUM" },
  "priority": 100,
  "status": "ACTIVE"
}
```

### 삭제와 상태 정책

- DELETE는 soft delete로 구현한다. 기본 목록과 상세 조회에서 삭제된 항목은 제외한다.
- 삭제되지 않은 Expression 또는 Rule이 연결된 Term의 삭제는 `409 Conflict`로 거절한다. UI에 관련 항목을 먼저 정리하도록 안내한다.
- 삭제된 Term에 새 Expression이나 Rule을 연결할 수 없다.
- Semantic Search에는 `ACTIVE`이면서 삭제되지 않은 데이터만 노출한다. Expression과 Rule은 연결 Term도 같은 조건을 만족해야 한다.
- Term 비활성화 시 자식의 원본 상태를 일괄 변경하지 않는다. 대신 검색 노출과 인덱스 동기화에 부모 상태를 반영한다.

## 4. Embedding과 Vector Store

실제 모델은 `Qwen3-Embedding-4B-GGUF`를 사용한다.

모델 참고: https://huggingface.co/Qwen/Qwen3-Embedding-4B-GGUF

구현 시 모델 문서와 선택한 런타임의 공식 문서를 확인한다. 모델 이름만 보고 endpoint, 벡터 차원, pooling, 정규화, query instruction 형식을 추정하지 않는다. 확인한 설정과 실행 방법을 README에 기록한다.

예시 인터페이스:

```ts
interface EmbeddingProvider {
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: string[]): Promise<number[][]>;
}
```

검색 질의와 문서 임베딩은 모델이 요구하는 입력 형식을 각각 적용한다. Qwen adapter는 llama.cpp server 등 별도 HTTP embedding service를 호출하도록 구현한다. Next.js 프로세스 내부에서 모델을 직접 로딩하지 않는다.

Vector Store에는 최소 `upsert`, `delete`, `search`가 필요하다. 벡터 식별자는 `entityType:entityId`처럼 재실행해도 동일하도록 구성한다. 검색 결과는 후보 ID와 유사도 점수이며 원본 응답 데이터가 아니다.

### 임베딩할 텍스트

- Term: 이름, 정의, domain을 레이블과 함께 구성
- Expression: 표현 text 자체
- Rule: 이름, 규칙 유형, 설명. condition JSON 전체를 주 검색 텍스트로 사용하지 않는다.

텍스트 생성 함수를 분리한다. metadata에는 `entityType`, `entityId`, `termId`(해당 시), `domain`, 원본 version을 포함한다.

모델·차원·텍스트 구성 방식이 바뀌면 인덱스를 재생성해야 한다. 인덱스 설정에 모델과 차원을 기록하고 호환되지 않는 벡터가 섞이지 않도록 한다.

### 로컬 mock 모드

```env
EMBEDDING_PROVIDER=mock
# 실제 모델 사용 시 qwen
```

- 기본 실행은 네트워크나 모델 다운로드가 필요 없는 deterministic mock provider를 사용한다.
- mock은 인덱싱·검색 흐름을 확인하기 위한 것이다. 의미 유사도를 보장하지 않는다.
- UI와 README에 현재 provider 및 mock의 한계를 표시한다.
- mock 점수를 실제 검색 품질로 설명하거나 특정 의미 검색 결과가 나오도록 하드코딩하지 않는다.
- mock과 Qwen의 인덱스는 분리하고 provider 전환 시 재인덱싱 절차를 제공한다.

## 5. 원본과 인덱스 동기화

임베딩 또는 Vector Store 장애가 원본 CRUD를 실패시키지 않아야 한다.

```text
원본 변경 + 인덱싱 작업 기록을 하나의 PostgreSQL transaction으로 저장
  → 별도 worker가 작업 처리
  → Embedding 생성 / Vector upsert 또는 delete
  → 처리 결과 기록
```

- PostgreSQL 작업 테이블과 단일 worker로 시작한다. 별도 메시지 브로커는 도입하지 않는다.
- HTTP 응답 이후 메모리에서만 실행되는 작업에 의존하지 않는다.
- 작업 상태는 `PENDING | PROCESSING | READY | FAILED`로 관리하고 시도 횟수, 오류, 처리 시각을 기록한다.
- 실패 재시도와 프로세스 재시작 후 중단 작업 복구가 가능해야 한다. CLI 방식도 허용한다.
- 작업을 중복 실행해도 결과가 일관되어야 한다.
- 처리할 때 최신 원본과 version을 확인한다. 처리 중 원본이 바뀌면 후속 작업을 보장하고, 오래된 작업이 최신 완료 상태를 덮어쓰지 않게 한다.
- 텍스트가 바뀌면 재임베딩한다. 상태, domain, 연결 Term 변경은 검색 조건과 metadata에도 반영한다.
- Term 상태·domain 변경처럼 자식 검색에 영향을 주는 변경은 관련 Expression과 Rule의 인덱스에도 반영한다.
- 삭제 또는 검색 대상 제외 시 vector를 삭제한다. 인덱스 반영 전이라도 검색 시 PostgreSQL에서 재검증하여 비활성·삭제 데이터가 노출되지 않게 한다.
- 전체 인덱스를 원본에서 다시 만드는 명령을 제공한다.

관리 UI에서는 현재 원본에 대한 인덱싱 대기·완료·실패 여부를 확인할 수 있어야 한다. CRUD 성공을 인덱싱 완료로 표시하지 않는다.

## 6. API와 검색 계약

다음 REST API를 제공한다. 수정은 부분 변경을 지원하는 PATCH를 사용한다.

```text
GET / POST           /api/terms
GET / PATCH / DELETE /api/terms/:id
GET / POST           /api/expressions
GET / PATCH / DELETE /api/expressions/:id
GET / POST           /api/rules
GET / PATCH / DELETE /api/rules/:id
POST                 /api/search/governance
```

- 목록은 `q`, `domain`, `status`, `page`, `pageSize`를 지원한다. Expression과 Rule 목록은 `termId` 필터도 지원한다.
- 목록의 `q`는 일반 텍스트 검색이다. Semantic Search와 구분한다.
- 페이지 크기는 기본 20, 최대 100이며 정렬은 안정적으로 유지한다.
- 입력은 서버에서 검증하고, 잘못된 입력 400 / 미존재 404 / 중복·관계 충돌 409를 일관된 오류 형식으로 반환한다.
- 생성은 201, 성공한 삭제는 204를 반환한다.
- Term 상세 응답이나 관련 목록 API로 연결 Expression과 Rule을 조회할 수 있어야 한다.

Semantic Search 요청 예시:

```json
{
  "query": "고객 식별번호",
  "types": ["TERM", "EXPRESSION"],
  "domain": "CUSTOMER",
  "topK": 10
}
```

- query는 비어 있지 않아야 한다. types 생략 시 세 유형 모두, topK 기본값은 10, 최대는 100이다.
- `types`가 빈 배열이거나 허용되지 않은 유형을 포함하면 400을 반환한다.
- 통합 API 하나로 시작하며 유형별 중복 endpoint는 만들지 않는다.

검색 흐름:

```text
query → embedQuery → VectorStore.search → 후보 ID
      → PostgreSQL 원본 조회 및 노출 조건 재검증 → 결과 반환
```

- entityType과 domain 필터를 Vector Store에 전달하고 원본에서도 확인한다.
- 원본 version과 맞지 않는 인덱스 후보는 제외한다.
- 후보 제외 후 결과 수가 topK보다 적을 수 있다. 무제한 재검색하지 않는다.
- 결과는 `type`, `id`, 표시용 `text`, `termId`(해당 시), `score`를 포함하며 유사도 순으로 반환한다.
- 점수의 의미와 정렬 방향을 adapter 계약에 명시한다. 점수를 정답 확률이나 규칙 위반 확률로 표시하지 않는다.
- 검색 서비스 장애는 503 등 명시적인 오류로 전달한다. 실제 provider 실패 시 몰래 mock으로 전환하지 않는다.

Rule 검색은 관련 규칙을 찾는 기능이다. 조건 충족 여부나 위반 여부를 판정하지 않는다.

## 7. 관리 UI

내비게이션은 Terms / Expressions / Rules / Semantic Search로 구성한다. 정보 구조와 작업 효율을 우선하며 복잡한 디자인 시스템은 도입하지 않는다.

- 공통: 목록, 검색·필터, 페이지 이동, 생성·편집 폼, 상세, 비활성화·삭제
- Term 상세: 기본 정보, 연결 Expression, 연결 Rule
- Expression: 표현, Term, 유형, domain, 상태. Term은 검색하여 선택
- Rule: 기본 정보, 대상 Term, scope, condition, action, priority, 상태를 구분한 폼
- Rule condition: FORMAT은 regex, ENUM은 허용값 목록, RANGE는 min/max 등 유형별 입력. 전체 Rule을 JSON textarea 하나로 관리하지 않는다.
- Semantic Search: 검색어, 유형·domain 필터, 현재 provider, 결과 점수와 연결 Term, 상세 이동
- 로딩, 빈 결과, 입력 오류, 서버 오류, 삭제 확인, 인덱싱 상태를 표시한다.

## 8. 로컬 실행과 seed

Docker Compose로 다음을 실행할 수 있게 한다.

- Next.js
- PostgreSQL
- LanceDB 영속 볼륨. app과 worker가 동일한 경로를 공유
- 인덱싱 worker

기본 구성은 mock provider로 동작한다. 실제 Qwen service는 선택적인 Compose profile 또는 외부 endpoint로 연결한다. 대용량 모델 다운로드를 기본 기동의 필수 단계로 만들지 않는다.

`.env.example`, migration, 중복 생성 없이 다시 실행 가능한 seed를 제공한다. seed 데이터도 일반 데이터와 같은 인덱싱 흐름을 거친다.

최소 seed:

| Term | 정의 | Domain | Expressions | Rules |
| --- | --- | --- | --- | --- |
| 고객번호 | 고객을 식별하기 위해 부여되는 고유 번호 | CUSTOMER | 고객 ID, 고객 식별번호, 회원번호, Customer ID | CUST- 접두사 뒤 숫자 10자리 형식 |
| 주민등록번호 | 대한민국 주민에게 부여되는 개인 식별번호 | CUSTOMER | 주민번호, 주민 등록 번호, RRN | 외부 문서에서 뒤 7자리 마스킹 |

seed는 검색 가능한 ACTIVE 상태로 생성한다. 실제 개인 식별번호 데이터는 필요하지 않다.

README에 다음을 기록한다.

- 사전 요구사항, 설치, 환경 변수, 기동, migration, seed 명령
- 주요 구조, 관계·삭제 정책, Vector Store 선택 이유와 제약
- API 요청·응답 및 오류 예시
- mock의 한계와 실제 Qwen 연결 설정
- worker 실행, 실패 작업 재시도, 전체 재인덱싱 방법
- 수동 검증 절차와 실제 확인하지 못한 항목

## 9. 테스트와 검증 범위

**광범위한 테스트 코드는 요구하지 않는다. 정합성 위험이 큰 동작에만 소수의 자동 테스트를 작성한다.** 테스트 개수나 커버리지 수치를 목표로 삼지 않는다.

자동 검증할 핵심 동작:

1. 임베딩 실패 후에도 원본이 보존되고, 실패 작업을 재시도하면 인덱스가 갱신된다.
2. 최신 원본 변경 이후 오래된 작업이 처리되어도 최신 상태로 수렴하며, 중복 처리로 vector가 늘어나지 않는다.
3. 인덱스가 지연되어도 삭제·비활성 원본과 비활성 Term의 하위 항목이 검색 응답에서 제외된다.

작은 fake provider/store와 필요한 범위의 PostgreSQL 통합 검증을 사용한다. 테스트는 실제 Qwen 모델이나 외부 서비스 다운로드에 의존하지 않는다. mock으로 의미 검색 품질을 검증하지 않는다.

단순 CRUD별 반복 테스트, UI snapshot, 전체 E2E suite는 MVP 필수 범위에서 제외한다. 기존 테스트가 있다면 유지하고 변경에 필요한 검증만 수행한다.

완료 전에는 다음을 확인한다.

- 프로젝트가 제공하는 타입 검사, lint, build 및 위 핵심 테스트
- 로컬 기동, migration, seed, CRUD와 연결 관계 확인
- worker 처리, 검색 API·UI, 삭제·비활성 후 검색 제외 확인

수동 검증은 README에 재현 가능한 절차로 남긴다. 실행하지 못한 검증은 원인과 실행 명령을 명시하고 성공했다고 보고하지 않는다.

## 10. 진행 방식과 완료 기준

먼저 현재 repository와 지침을 확인하고 기존 구현·관례를 활용한다. 코드 수정 전에 다음을 간결하게 설명한 뒤 구현을 계속한다.

1. 현재 구조와 재사용할 부분
2. 제안 아키텍처와 PostgreSQL schema
3. 선택한 Vector Store, 임베딩 연결 및 동기화 방식
4. 주요 구현 파일과 진행 순서

기본값으로 해결 가능한 선택은 직접 결정하고 기록한다. 핵심 요구사항이 충돌하거나 진행에 필수인 정보가 없을 때만 질문한다.

권장 구현 순서:

```text
저장소 확인 → schema / migration → CRUD / 관계 → 관리 UI
→ Embedding / Vector adapter → worker / 동기화 → 검색 API / UI
→ seed / 실행 환경 → 핵심 검증 / README
```

완료 기준:

- 문서화된 명령으로 mock 모드 로컬 환경을 실행할 수 있다.
- UI와 API에서 세 엔티티를 관리하고 관계를 확인할 수 있다.
- 원본 변경이 영속 작업을 통해 검색 인덱스에 반영된다.
- 실패 작업을 재시도하고 원본에서 인덱스를 재생성할 수 있다.
- 검색은 PostgreSQL에서 확인한 유효한 원본 후보를 반환한다.
- 실제 Qwen adapter와 연결 절차가 제공된다. 실모델 실행을 확인하지 못했다면 명시한다.

최종 보고에는 구현 결과, 실행 방법, 수행한 검증, 남은 제약만 간결하게 정리하라.
