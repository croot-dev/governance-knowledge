# Governance Knowledge

표준 용어(Term), 표현(Expression), 거버넌스 규칙(Rule)을 관리하고 벡터로 검색하는 로컬 MVP입니다.

**Next.js App Router · TypeScript · shadcn/ui · PostgreSQL · LanceDB · pnpm**

후속 서비스 설계: [RAG 문서 의미분석·보강 아키텍처](docs/rag-document-enrichment-architecture.md) · [작업 계획안](docs/rag-document-enrichment-plan.md). 기존 거버넌스를 독립 컴포넌트로 활용하는 LangChain/LangGraph 기반 제안이며, 현재 구현 기능과 구분합니다.

인증·권한이 없는 개발용입니다. 멀티모달 추출·OCR·MD 규칙 변환·Rule 버전 보관을 구현했으며, RAG 의미분석·내용 보강 및 LangGraph는 아직 설계 단계입니다.

## NVIDIA 호스팅 API 기본 구성

로컬 자원을 줄이기 위해 Compose 기본값은 `EMBEDDING_PROVIDER=nvidia`, `OCR_PROVIDER=nvidia`입니다. `.env.example`을 `.env`로 복사하고 `NVIDIA_API_KEY`를 설정하세요. 기존 `.env`가 있으면 키와 provider 설정을 직접 갱신해야 합니다. 키는 서버에서만 사용합니다.

- OCR: `qwen/qwen3.5-122b-a10b`의 이미지 chat API.
- 임베딩: `nvidia/llama-3.2-nv-embedqa-1b-v2`, 2048차원. query/passage를 구분하고 입력을 자동 잘라내지 않습니다.
- PostgreSQL·LanceDB·파일 저장과 PDF 페이지 변환은 로컬에서 실행합니다. 로컬 Ollama·llama.cpp 모델 서버는 기본 실행에서 제외했습니다.
- 프로세스당 API 요청 하나씩 실행하고 요청 간 기본 2초 간격을 둡니다. 429/502/503/504는 최대 2회 재시도합니다. 계정 전체 분산 rate limiter는 아직 없으므로 worker 수를 늘릴 때 총 호출량을 고려해야 합니다.
- OCR 출력 잘림은 PARTIAL이며 빈 응답·비정상 종료를 성공으로 처리하지 않습니다. 토큰 기반 자동 재분할·페이지 checkpoint는 후속 구현입니다.

NVIDIA API 키가 없거나 API가 실패해도 mock으로 자동 대체하지 않습니다. 외부 호출 없이 검증하려면 명시적으로 `EMBEDDING_PROVIDER=mock`, `OCR_PROVIDER=none`을 설정하세요. 모델 변경 시 새 검색 프로필이 생성되며 해당 프로필의 인덱싱이 끝나야 검색 결과가 채워집니다. 기존 벡터 테이블은 유지됩니다.

로컬 모델을 쓰려면 provider를 `ollama`/`qwen`으로 설정합니다. OCR과 임베딩 모두 macOS Ollama 앱(`brew services start ollama`)을 씁니다.

NVIDIA 호스팅 API의 무료 이용은 개발·평가용입니다. [공식 이용 안내](https://docs.api.nvidia.com/nim/docs/product), [Vision API](https://docs.api.nvidia.com/nim/reference/qwen-qwen3-5-122b-a10b-infer), [다국어 embedding 모델](https://docs.api.nvidia.com/nim/reference/nvidia-llama-3_2-nv-embedqa-1b-v2).

## 빠른 시작

Docker Desktop 또는 Docker Engine + Compose가 필요합니다. 위 NVIDIA API 설정을 먼저 완료하세요. 최초 컨테이너 빌드에는 앱 패키지와 이미지 다운로드가 필요하지만 로컬 모델은 다운로드하지 않습니다.

```sh
docker compose up --build -d
```

[http://localhost:3000](http://localhost:3000)에서 엽니다. setup 서비스가 migration과 seed를 실행하고, worker가 인덱싱합니다. 처음에는 인덱싱 대기 상태일 수 있습니다.

```sh
docker compose logs -f setup worker
# 종료 (데이터 볼륨 유지)
docker compose down
```

PostgreSQL과 LanceDB 데이터는 각각 `postgres_data`, `lance_data` 볼륨에 유지됩니다. app과 worker는 동일한 LanceDB 경로를 공유합니다. PostgreSQL 포트 5432와 앱 포트 3000은 호스트의 loopback에만 공개합니다.

### 호스트에서 개발

Node.js 22 이상, pnpm 11.3.0을 사용합니다. 프로젝트의 `packageManager`와 lockfile을 따르세요.

```sh
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm worker
```

다른 터미널에서:

```sh
pnpm dev
```

호스트 방식의 LanceDB는 `.data/lancedb`에 저장됩니다. 컨테이너 worker와 호스트 worker를 동시에 실행하지 마세요. 호스트와 Compose의 LanceDB 경로는 별개이므로 실행 방식을 바꾸면 해당 경로를 재인덱싱합니다.

| 환경 변수                 | 기본값 / 의미                                                              |
| ------------------------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`            | 필수. `.env.example`에 로컬 PostgreSQL 연결 예시 제공                      |
| `EMBEDDING_PROVIDER`      | `nvidia`, `mock`, `qwen`; Compose·설정 예제는 `nvidia`                     |
| `EMBEDDING_REVISION`      | `v1`. 모델 가중치·양자화·입력 구성 변경 시 새 값 사용                      |
| `STORAGE_LANCEDB_URI`     | 호스트 `.data/lancedb`, Compose `/data/lancedb`                            |
| `EMBEDDING_QWEN_BASE_URL` | 호스트 `http://localhost:8080/v1`; Compose에서는 host.docker.internal 사용 |
| `EMBEDDING_QWEN_MODEL`    | `Qwen3-Embedding-4B-GGUF`                                                  |
| `EMBEDDING_QWEN_API_KEY`  | 선택. HTTP embedding service의 인증 토큰                                   |

`.env`는 커밋하지 않습니다. Compose에서 Qwen을 사용할 때 `.env`의 `EMBEDDING_QWEN_BASE_URL`을 `http://host.docker.internal:8080/v1`로 지정하세요. 컨테이너의 localhost는 호스트가 아닙니다.

## 화면

- **표준 용어**: 이름·정의·domain·상태 관리, 연결된 표현과 규칙 조회
- **표현 · 별칭**: Term을 검색하여 연결하고 표현 유형 관리
- **거버넌스 규칙**: 기본 정보, 대상, scope, condition, action, 우선순위 관리
- **시맨틱 검색**: 유형·domain 필터, provider 표시, 점수 및 원본 상세로 이동

공통 UI는 공식 shadcn/ui 레지스트리의 Button, Input, Textarea, NativeSelect, Dialog, Badge, Table, Alert, Checkbox, Label을 사용합니다. `components.json`과 `src/components/ui/`에서 관리합니다.

```sh
pnpm dlx shadcn@latest add <component>
```

mock 모드의 점수와 순위는 의미 검색 품질을 나타내지 않습니다. 특정 검색어와 정답을 연결하는 하드코딩은 없습니다.

## 구조와 데이터 정책

```text
src/app                 UI 페이지 및 Route Handler
src/components          관리 화면, shadcn/ui
src/domain              모델, 스키마, provider/store/repository 계약
src/application         CRUD, 인덱싱, 검색 유스케이스
src/infrastructure/db   PostgreSQL repository 및 연결
src/infrastructure/embedding    mock / Qwen HTTP adapter
src/infrastructure/vector-store LanceDB adapter
scripts                 migration, seed, worker, retry, rebuild
migrations              체크섬으로 관리하는 SQL migration
tests                   핵심 정합성 통합 검증 3개
```

PostgreSQL의 `terms`, `expressions`, `rules`가 원본입니다. Expression과 Rule은 각각 하나의 Term을 외래 키로 참조합니다. 검색 domain은 부모 Term에서 유도합니다.

- UUID, 상태, version, UTC 생성·수정 시각, soft delete 시각을 저장합니다.
- 이름·표현 비교에는 NFKC, 공백 정리, 영문 소문자화를 사용하고 표시 원문은 유지합니다.
- 동일 domain의 Term 이름과 동일 Term의 Expression text는 삭제되지 않은 항목끼리 고유합니다. domain 코드는 대소문자를 구분합니다.
- 다른 Term에 같은 표현을 연결할 수 있습니다. 검색 결과를 단일 Term으로 자동 확정하지 않습니다.
- 연결된 미삭제 표현·규칙이 있는 Term 삭제는 409입니다. 자식을 삭제하거나 다른 Term으로 옮긴 후 삭제합니다.
- 부모 비활성화는 자식의 상태를 바꾸지 않지만, 부모와 자식 모두 검색에서 제외합니다.
- 규칙은 유형별 condition과 action 스키마를 검증합니다. JSON을 실제 문서에 실행하지 않습니다.
- PATCH는 전달한 필드만 변경하고 version을 증가시킵니다. 전체 변경 이력과 낙관적 동시 편집 충돌 UI는 없습니다. 동일 항목의 같은 필드에는 마지막 쓰기가 적용됩니다.

단일 로컬 MVP의 참조 정합성을 위해 원본 쓰기 transaction은 PostgreSQL advisory lock으로 직렬화합니다. 임베딩 네트워크 호출은 이 transaction 밖에서 수행하므로 임베딩 장애가 원본 저장을 롤백하지 않습니다. 쓰기 처리량이 커지면 정해진 잠금 순서를 갖는 행 단위 잠금으로 바꿀 수 있습니다.

### LanceDB를 선택한 이유

별도 서버 없이 로컬 파일에 벡터를 영속 저장할 수 있고, 2,560차원 Qwen 벡터와 metadata 필터를 같은 SDK로 다룰 수 있습니다. `VectorStore` 인터페이스 밖으로 LanceDB SDK를 노출하지 않습니다.

MVP는 근사 인덱스를 생성하지 않고 코사인 거리로 정확 검색합니다. 소규모 데이터에서는 인덱스 학습·튜닝이 필요 없지만, 데이터가 늘면 전체 스캔 비용이 증가합니다. 대규모 운영 전 IVF/HNSW 등 인덱스 선택과 성능 측정이 필요합니다.

`entityType:entityId`를 키로 `mergeInsert` upsert하며, 실제 쓰기 프로세스는 단일 worker입니다. 읽기는 최신 커밋을 확인하는 설정과 새 테이블 핸들을 사용합니다. 로컬 파일 볼륨을 공유하지 않는 다중 호스트·serverless 배포는 현재 구성의 범위가 아닙니다. [LanceDB 업데이트 문서](https://docs.lancedb.com/tables/update), [일관성 문서](https://docs.lancedb.com/tables/consistency)

### 동기화와 복구

```text
원본 변경 + index_jobs 등록 (동일 PostgreSQL transaction)
  → 단일 worker가 PENDING 작업 확보
  → 최신 원본으로 embedding 생성 / vector 삭제
  → LanceDB upsert
  → 해당 작업 revision이 여전히 같을 때만 READY
```

`index_profiles`는 provider·model·dimension·revision을 기록합니다. 프로필마다 LanceDB 테이블과 작업 상태를 분리하므로 mock과 Qwen 벡터가 섞이지 않습니다. 새 프로필을 처음 사용하면 기존 원본도 작업으로 등록합니다. 원본 변경은 등록된 모든 프로필을 무효화하며, 사용하지 않는 프로필은 worker가 없으면 PENDING으로 남습니다.

작업은 엔티티별 최신 revision으로 합쳐지고 `PENDING / PROCESSING / READY / FAILED`, 시도 횟수, 오류, 처리 시각을 저장합니다. 임베딩 중 수정되면 오래된 결과를 버립니다. upsert 직후 원본이 바뀌더라도 이전 작업이 새 작업을 완료로 표시할 수 없습니다. 프로세스 재시작 시 PROCESSING 작업을 복구합니다.

worker/rebuild는 PostgreSQL 세션 advisory lock을 공유합니다. 두 번째 writer는 명확한 오류로 종료됩니다. 인덱싱 실패는 FAILED에 머물며 자동으로 무한 재시도하지 않습니다.

```sh
# 대기 작업을 한 번 모두 처리. FAILED가 남으면 비정상 종료 코드.
pnpm worker:once

# 실패 원인을 해결한 후 FAILED → PENDING
pnpm index:retry
pnpm worker:once

# 장기 실행 worker를 먼저 종료한 후 실행
pnpm index:rebuild
pnpm worker
```

재생성은 작업을 먼저 영속 등록한 뒤 현재 프로필의 벡터를 비웁니다. 중단 후 worker를 다시 실행하면 복구됩니다. 다른 프로필의 테이블과 원본은 유지합니다. READY는 upsert 또는 검색 제외 처리가 완료됐다는 뜻이며, 비활성 항목에 vector가 있다는 뜻은 아닙니다.

Compose에서는 다음처럼 실행합니다.

```sh
docker compose stop worker
docker compose run --rm --no-deps worker pnpm index:rebuild
docker compose up -d worker

# 실패 작업 재시도는 실행 중인 worker와 함께 사용할 수 있음
docker compose exec worker pnpm index:retry
```

provider를 바꾸거나 revision을 변경하면 app과 worker에 같은 설정을 적용합니다. 전체 재생성 동안 검색 결과가 적거나 비어 있을 수 있습니다. 무중단 인덱스 교체와 오래된 LanceDB 버전 파일의 자동 정리는 MVP 범위 밖입니다.

## 실제 Qwen 연결

별도 llama.cpp `llama-server`를 사용합니다. GGUF 파일은 직접 준비하며 기본 Compose 실행은 모델을 다운로드하지 않습니다.

```sh
llama-server \
  -m /absolute/path/Qwen3-Embedding-4B-Q4_K_M.gguf \
  --alias Qwen3-Embedding-4B-GGUF \
  --embedding --pooling last --embd-normalize 2 \
  -ub 8192 --host 0.0.0.0 --port 8080
```

모델 파일 경로는 내려받은 실제 파일명으로 바꾸세요. Q4_K_M도 수 GB 크기이며 메모리와 실행 시간은 하드웨어에 따라 다릅니다. llama.cpp 버전·양자화 파일은 사용 환경에 맞춰 고정하고 `EMBEDDING_REVISION`에 반영하세요.

```env
EMBEDDING_PROVIDER=qwen
EMBEDDING_REVISION=qwen-q4km-v1
EMBEDDING_QWEN_MODEL=Qwen3-Embedding-4B-GGUF
# 호스트 app/worker
EMBEDDING_QWEN_BASE_URL=http://localhost:8080/v1
# Compose에서는 http://host.docker.internal:8080/v1
```

확인한 모델·런타임 계약:

- Qwen3-Embedding-4B의 전체 출력 차원은 **2560**입니다. adapter는 차원을 줄이지 않으며 응답 차원과 유한값, 0이 아닌 norm을 검증합니다.
- 모델은 last pooling을 사용합니다.
- adapter는 `/v1/embeddings`에 `input`, `model`, `encoding_format: float`를 보냅니다.
- query에 `Instruct: …\nQuery:…` 형식을 적용하고 document에는 instruction을 붙이지 않습니다.
- 응답을 L2 정규화합니다. HTTP timeout은 60초이며 실모델 실패 시 mock으로 대체하지 않습니다.

공식 근거: [GGUF 모델 카드](https://huggingface.co/Qwen/Qwen3-Embedding-4B-GGUF), [query instruction 예시](https://huggingface.co/Qwen/Qwen3-Embedding-4B), [llama.cpp server API](https://github.com/ggml-org/llama.cpp/tree/master/tools/server)

**이번 구현에서 실제 Qwen 모델 추론은 실행하지 않았습니다.** 실제 의미 검색 품질과 하드웨어 적합성은 실모델 연결 후 확인해야 합니다.

## API

| 경로                                           | 메서드                                          |
| ---------------------------------------------- | ----------------------------------------------- |
| `/api/terms`, `/api/expressions`, `/api/rules` | GET 목록, POST 생성                             |
| `/api/{collection}/{id}`                       | GET 상세, PATCH 부분 수정, DELETE soft delete   |
| `/api/search/governance`                       | POST 벡터 검색                                  |
| `/api/config`                                  | GET 공개 provider 정보. 인증 토큰·연결 URL 제외 |

목록 공통 query: `q`, `domain`, `status`, `page`(기본 1), `pageSize`(기본 20, 최대 100). Expression/Rule에는 `termId` 필터도 있습니다. `q`는 이름·표현의 부분 문자열 검색이고, 생성 시각 내림차순과 id로 안정 정렬합니다. `%`, `_`는 일반 문자로 처리합니다.

```sh
curl 'http://localhost:3000/api/terms?page=1&pageSize=20&domain=CUSTOMER'

curl -X POST http://localhost:3000/api/terms \
  -H 'Content-Type: application/json' \
  -d '{"name":"주문번호","definition":"주문을 식별하는 고유 번호","domain":"ORDER","status":"ACTIVE"}'

curl -X PATCH http://localhost:3000/api/terms/REPLACE_WITH_UUID \
  -H 'Content-Type: application/json' -d '{"status":"INACTIVE"}'

curl -X POST http://localhost:3000/api/search/governance \
  -H 'Content-Type: application/json' \
  -d '{"query":"고객 식별번호","types":["TERM","EXPRESSION"],"domain":"CUSTOMER","topK":10}'
```

목록 응답:

```json
{ "items": [], "total": 0, "page": 1, "pageSize": 20 }
```

검색 응답 형식(예시 점수는 실제 모델 검증 결과가 아님):

```json
{
  "results": [
    {
      "type": "EXPRESSION",
      "id": "<UUID>",
      "text": "고객 ID",
      "termId": "<UUID>",
      "termName": "고객번호",
      "domain": "CUSTOMER",
      "score": 0.82
    }
  ],
  "provider": "qwen",
  "scoreMetric": "cosine_similarity"
}
```

`types` 생략 시 세 유형 모두, `topK` 기본 10·최대 100입니다. 빈 types, 빈 query, 잘못된 유형·범위는 400입니다. score는 `1 - cosine distance`로 높을수록 유사하며 정답·위반 확률이 아닙니다.

검색은 최대 `min(topK × 3, 300)` 후보를 조회하고 PostgreSQL에서 원본과 부모 상태, domain, version을 다시 검증합니다. 자식의 stamp에는 부모 version도 포함합니다. 삭제·비활성·오래된 후보가 제거되면 topK보다 적게 반환할 수 있습니다. Vector Store의 text를 API 원본으로 사용하지 않습니다.

- 201 생성, 204 삭제
- 400 입력 검증, 404 미존재·삭제 항목, 409 중복·관계 충돌
- 413 요청 본문 제한, 503 검색·저장 서비스 장애

오류 형식:

```json
{
  "error": {
    "code": "HAS_RELATIONS",
    "message": "연결된 Expression과 Rule을 먼저 삭제하거나 다른 Term으로 옮겨주세요."
  }
}
```

Rule 스키마:

| 유형                           | condition                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------- |
| FORMAT                         | `{"operator":"regex","pattern":"^CUST-[0-9]{10}$"}`                               |
| MASKING                        | `{"operator":"regex","pattern":"^([0-9]{6})-?[0-9]{7}$"}` (마스킹 대상 매칭 패턴) |
| REQUIRED                       | `{"operator":"exists"}`                                                           |
| ENUM                           | `{"operator":"in","values":["A","B"]}`                                            |
| RANGE                          | `{"operator":"between","min":0,"max":100}`                                        |
| PROHIBITED / RELATION / CUSTOM | JSON object. 도메인별 평가 스키마는 추후 확장                                     |

`scope`는 JSON object이며 실제 적용 판정은 하지 않습니다. `action`은 `onViolation: REPORT | BLOCK | WARN`, `severity: LOW | MEDIUM | HIGH`를 저장합니다. MASKING 규칙은 `action`에 `replacement`(치환 형식, 예: `$1-*******`)와 `resultPattern`(수정 완료 패턴, 예: `^[0-9]{6}-\*{7}$`)을 추가로 필수 저장합니다. 매칭 패턴(`condition.pattern`)은 아직 마스킹되지 않은 원본 값을, 수정 완료 패턴은 이미 마스킹된 값을 판정하므로 둘을 분리합니다. 두 정규식은 저장 시 컴파일 가능 여부만 검증하며 실제 치환은 수행하지 않습니다. priority는 정수이며 큰 값이 우선하지만 벡터 유사도 순위와 별개입니다.

### 문서 표준화

`POST /api/transform` (multipart, 필드 `file`)에 UTF-8 `.md` 파일(최대 1MB)을 올리면 활성 데이터를 적용한 Markdown과 적용 내역을 반환합니다. 화면은 `/governance/transform`입니다. 임베딩·벡터 저장소를 쓰지 않고 RDB의 활성 Term·Expression·Rule만 읽으며, 업로드 문서는 저장하지 않습니다.

- **표준 용어 치환**: 활성 Expression을 연결된 Term 이름으로 바꾸고, 은/는·이/가·을/를·과/와·으로/로 조사를 받침에 맞춥니다. 다른 단어의 일부, 코드 블록·인라인 코드·링크 주소는 바꾸지 않습니다. 여러 Term에 연결된 표현은 바꾸지 않고 `ambiguous`로 보고합니다.
- **MASKING**: 매칭 패턴으로 찾은 값을 치환 형식으로 바꾸고, 결과가 수정 완료 패턴과 맞을 때만 반영합니다. 개인정보 보호를 위해 코드 블록 안에도 적용하며 `scope`는 판정하지 않습니다.
- **PROHIBITED** (`{"operator":"notContains","pattern":...}`): 변환 후 남은 위반을 `violations`로 보고만 합니다.
- **그 밖의 유형**: 값과 Term의 연결이 필요해 자동 적용하지 않고 `skipped`에 이유와 함께 보고합니다.

### 거버넌스 카탈로그 (RAG 계획 1단계)

의미 검색이 아니라 code로 정확히 조회하는 기준정보입니다. 문서 유형·직급은 아직 CRUD 화면이 없고 seed로 등록합니다.

| API                                                              | 동작                                                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/catalog/document-types`                                | 활성 문서 유형 정의와 긍정·부정 분류 예시                                                                                            |
| `GET /api/catalog/job-grades?scheme=KR_STANDARD&atLeast=MANAGER` | 같은 직급 체계 안에서 “과장 이상” 범위                                                                                               |
| `POST /api/catalog/applicable-rules`                             | `{"termIds":[...],"documentType":"EXTERNAL_SUBMISSION"}` → Term 정의와 규칙 스냅샷, 규칙별 `APPLIES / NOT_APPLICABLE / UNDETERMINED` |
| `GET /api/catalog/rules/:id/versions/:version`                   | 과거 Rule 내용 재현 (`rule_versions`, DB 트리거로 모든 변경 기록)                                                                    |

문서 유형에 묶인 규칙(`rule_document_types`)은 문서 유형을 모르면(`UNKNOWN`) “적용 대상 아님”이 아니라 `UNDETERMINED`로 반환합니다. 묶이지 않은 규칙은 모든 문서에 적용됩니다.

### 업로드·추출 (RAG 계획 2단계)

OCR, 레이아웃 설명, 임베딩은 모두 macOS에서 직접 실행한 Ollama(Metal GPU)를 쓰고, 컨테이너는 `host.docker.internal:11434`로 호출합니다. Docker Desktop은 macOS GPU를 쓰지 못해 모델을 컨테이너로 실행하지 않습니다. 처음 한 번 `brew services start ollama` 후 `ollama pull qwen3-vl:2b-instruct-q4_K_M`, `ollama pull qwen3-embedding:0.6b`로 모델을 받습니다. 임베딩은 Ollama의 OpenAI 호환 `/v1/embeddings`(1024차원)로 호출합니다. 더 큰 모델로 바꿀 때는 `OCR_OLLAMA_MODEL`(또는 `OCR_OLLAMA_LAYOUT_MODEL`), `EMBEDDING_QWEN_MODEL`, `EMBEDDING_QWEN_DIMENSIONS`(0.6B=1024, 4B=2560)를 함께 바꾸고 재인덱싱합니다.

```sh
B=$(curl -s -XPOST localhost:3000/api/upload-batches -H 'content-type: application/json' -d '{"mode":"FOLDER"}' | jq -r .id)
curl -XPOST "localhost:3000/api/upload-batches/$B/items?path=docs/a.md" --data-binary @a.md   # 파일마다 반복
curl -XPOST localhost:3000/api/upload-batches/$B/finalize
pnpm analysis-worker:once                                                                      # 또는 compose의 analysis-worker
curl localhost:3000/api/upload-batches/$B                                                      # manifest
curl localhost:3000/api/upload-batches/$B/items/<itemId>/content                               # ContentDocument
curl localhost:3000/api/upload-batches/$B/items/<itemId>/links                                 # 값-엔티티 연결
```

- 파일 본문은 요청 body로 스트리밍 저장합니다(파일당 50MB). 저장 key는 서버가 만들고 상대 경로는 메타데이터로만 보관합니다. 원본은 SHA-256과 함께 불변으로 저장하며 추출 전마다 hash를 다시 확인합니다.
- 지원 형식: MD(AST), TXT(문단), LOG(이벤트; 시간대 없는 timestamp는 추정하지 않음), PDF, 이미지(PNG/JPEG/WebP), ZIP. 확장자와 실제 내용이 모두 맞아야 인정합니다.
- 이미지와 PDF의 모든 쪽에는 OCR과 별도로 **레이아웃 설명**을 붙입니다. 같은 비전 모델(`OCR_OLLAMA_LAYOUT_MODEL`, 비우면 `OCR_OLLAMA_MODEL`)에 JSON 스키마를 지정해 요약과 화면 영역(유형, 라벨, 0–1000 좌표, 설명)을 받고 다시 검증합니다. 결과는 `VISUAL_SUMMARY`/`VISUAL_REGION` 블록(`origin: "INFERRED"`, 보호 구간)으로 저장해 원문·OCR 텍스트와 구분하며, 용어 연결·규칙 판정의 근거로 쓰지 않습니다. 응답이 잘리거나 계약에 맞지 않으면 OCR 결과는 유지하고 content를 `PARTIAL`로 표시합니다. 텍스트 레이어가 있는 PDF 쪽도 레이아웃 설명을 위해 렌더링하므로 쪽마다 모델 호출이 1회 늘어납니다. 화면의 "레이아웃" 탭에서 이미지 위에 영역을 겹쳐 볼 수 있습니다(PDF는 목록만).
- PDF는 쪽마다 텍스트 레이어(`pdftotext`)를 쓰고, 텍스트가 없는 쪽만 렌더링(`pdftoppm`)해 OCR합니다. 이미지는 바로 OCR합니다. OCR 블록은 `origin: "OCR"`과 쪽 번호를 가지며 위치는 쪽별 인식 텍스트 기준입니다. OCR 출력이 한도에서 잘리거나 OCR이 꺼져 건너뛴 쪽이 있으면 content를 `PARTIAL`로 표시하고 manifest 항목의 `contentQuality`로 드러냅니다. 암호화 PDF, `PDF_MAX_PAGES` 초과는 명시적으로 실패합니다.
- ZIP: 경로 이동·절대 경로·심볼릭 링크는 거부, 암호화·중첩 압축은 미지원으로 기록, 항목 수·총 용량·압축 비율 한도를 넘으면 압축 전체를 실패로 처리합니다.
- manifest의 `complete`는 목록 확정(`enumerationComplete`)과 모든 항목 처리 완료가 둘 다 참일 때만 참입니다. 실패·미지원 항목도 사유와 함께 manifest에 남습니다.
- **처리 중지**: 배치 화면의 "처리 중지"(`POST /api/upload-batches/:id/cancel`)는 대기 작업을 취소하고, 실행 중인 작업은 worker가 10초 안에 감지해 진행 중인 모델 호출까지 중단합니다. 중지된 작업의 결과는 반영하지 않으며, 중지·실패 항목은 "다시 처리"(`POST /api/upload-batches/:id/retry`)로 재개합니다.
- 작업은 `ingestion_jobs`에서 lease로 가져가므로 worker가 중단되어도 lease 만료 후 다른 worker가 이어받습니다. `pnpm analysis-worker --cleanup`은 오래된 미완료 업로드를 정리합니다.
- 값-엔티티 연결은 표 헤더와 `라벨: 값`이 등록된 용어·표현과 정확히 일치할 때만 만들고, 여러 Term에 걸리는 라벨은 `unresolved`로 보고합니다. 코드 블록은 연결하지 않습니다.

## 검증

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

자동 테스트는 PGlite(PostgreSQL WASM 엔진)와 임시 디렉터리의 실제 LanceDB, 작은 fake/mock provider를 사용합니다. Docker나 실제 Qwen 없이 실행되며 운영 PostgreSQL 데이터에는 접근하지 않습니다. 별도 PostgreSQL 서버의 연결·세션 잠금은 아래 수동 절차로 확인합니다.

1. 임베딩 장애 후 원본 보존, 실패 재시도, 중단 작업 복구
2. 임베딩/upsert 중 원본 변경, 오래된 작업 완료 방지, 중복 처리, 재인덱싱
3. 부모 상태·domain 변경, soft delete, 인덱스 지연 중 검색 제외

### 수동 확인 순서

1. migration과 seed를 실행하고 seed를 다시 실행해 Term 2개, Expression 7개, Rule 2개가 유지되는지 확인합니다. 기존 seed 항목의 사용자 수정·삭제는 seed가 되돌리지 않습니다.
2. `pnpm worker:once` 실행 후 각 ACTIVE 항목의 인덱싱 완료를 확인합니다.
3. Term을 생성·수정하고, 검색으로 선택하여 Expression과 Rule을 연결합니다. Term 상세에서 연결 목록을 확인합니다.
4. 동일 domain 안에서 공백·영문 대소문자만 다른 Term을 생성해 409를 확인합니다. 연결 자식이 있는 Term 삭제도 409여야 합니다.
5. 검색 페이지에서 mock 안내, 유형·domain 필터, 상세 이동을 확인합니다. mock 순위의 의미적 정확성을 평가하지 않습니다.
6. worker를 중지하고 Term을 비활성화합니다. 인덱스가 남아 있어도 해당 Term과 자식이 검색 결과에서 빠져야 합니다.
7. 다시 활성화하고 worker를 시작합니다. 수정된 version의 인덱싱이 완료되면 검색에 다시 나타납니다.
8. 두 번째 worker를 시작하면 단일 writer 잠금 오류로 종료되어야 합니다.
9. `index:retry`, `index:rebuild` 절차와 앱·worker 재시작 후 영속 데이터를 확인합니다.

실제 수행 내역과 미확인 항목은 [검증 기록](docs/verification.md)을 참고하세요.
