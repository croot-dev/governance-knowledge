"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { useEffect, useState } from "react";
import {
  expressionTypes,
  ruleTypes,
  statuses,
  type Collection,
  type Entity,
  type Page,
} from "@/domain/model";
import { api } from "./api";
import { ErrorNotice } from "./shared";
export const labels: Record<
  Collection,
  { title: string; singular: string; description: string; english: string }
> = {
  terms: {
    title: "표준 용어",
    singular: "용어",
    description: "조직의 데이터 언어를 정의하고, 표현과 규칙을 연결하세요.",
    english: "TERMS",
  },
  expressions: {
    title: "표현 · 별칭",
    singular: "표현",
    description: "문서 속 다양한 표현을 하나의 표준 용어에 연결하세요.",
    english: "EXPRESSIONS",
  },
  rules: {
    title: "거버넌스 규칙",
    singular: "규칙",
    description: "데이터의 형식, 사용 범위와 관리 기준을 정의하세요.",
    english: "RULES",
  },
};
function TermPicker({
  initial,
  onChange,
}: {
  initial?: Entity;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Entity[]>([]);
  const [selected, setSelected] = useState(
    initial?.termId ? { id: initial.termId, name: initial.termName } : null,
  );
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api<Page>(`/api/terms?pageSize=10&q=${encodeURIComponent(query)}`)
        .then((r) => {
          if (active) {
            setOptions(r.items);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);
  return (
    <div className="field full">
      <Label htmlFor="term-search">연결 Term *</Label>
      {selected && (
        <div className="selected-term">
          ↳ {selected.name ?? selected.id}
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setSelected(null);
              onChange("");
            }}
          >
            변경
          </Button>
        </div>
      )}
      {!selected && (
        <>
          <Input
            id="term-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="용어명으로 검색"
            autoComplete="off"
          />
          <div className="term-options">
            {options.map((e) => (
              <Button
                variant="ghost"
                key={e.id}
                type="button"
                onClick={() => {
                  setSelected({ id: e.id, name: e.name });
                  onChange(e.id);
                }}
              >
                <strong>{e.name}</strong>
                <span>
                  {e.domain} · {e.status}
                </span>
              </Button>
            ))}
            {!options.length && <small>선택 가능한 용어가 없습니다.</small>}
          </div>
        </>
      )}
      {error && <ErrorNotice message={error} />}
    </div>
  );
}
export function EntityForm({
  collection,
  entity,
  onSaved,
  onCancel,
}: {
  collection: Collection;
  entity?: Entity;
  onSaved: (entity: Entity) => void;
  onCancel: () => void;
}) {
  const [termId, setTermId] = useState(entity?.termId ?? "");
  const [ruleType, setRuleType] = useState(entity?.ruleType ?? "FORMAT");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const condition = entity?.condition ?? {};
  const field = (name: string) =>
    entity?.[name as keyof Entity] as string | undefined;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const form = new FormData(event.currentTarget);
      const value = (name: string) => String(form.get(name) ?? "");
      const data: Record<string, unknown> = { status: value("status") };
      if (collection === "terms")
        Object.assign(data, {
          name: value("name"),
          definition: value("definition"),
          domain: value("domain"),
        });
      else {
        if (!termId) throw new Error("연결할 Term을 선택해주세요.");
        data.termId = termId;
        if (collection === "expressions")
          Object.assign(data, { text: value("text"), type: value("type") });
        else {
          let ruleCondition: Record<string, unknown>;
          switch (ruleType) {
            case "FORMAT":
              ruleCondition = { operator: "regex", pattern: value("pattern") };
              break;
            case "MASKING":
              ruleCondition = { operator: "regex", pattern: value("pattern") };
              break;
            case "REQUIRED":
              ruleCondition = { operator: "exists" };
              break;
            case "ENUM":
              ruleCondition = {
                operator: "in",
                values: value("values")
                  .split("\n")
                  .map((v) => v.trim())
                  .filter(Boolean),
              };
              break;
            case "RANGE":
              ruleCondition = {
                operator: "between",
                min: Number(value("min")),
                max: Number(value("max")),
              };
              break;
            default:
              ruleCondition = JSON.parse(value("condition"));
          }
          Object.assign(data, {
            name: value("name"),
            description: value("description"),
            ruleType,
            scope: JSON.parse(value("scope")),
            condition: ruleCondition,
            priority: Number(value("priority")),
            action: {
              onViolation: value("onViolation"),
              severity: value("severity"),
              ...(ruleType === "MASKING"
                ? {
                    replacement: value("replacement"),
                    resultPattern: value("resultPattern"),
                  }
                : {}),
            },
          });
        }
      }
      const result = await api<Entity>(
        `/api/${collection}${entity ? `/${entity.id}` : ""}`,
        { method: entity ? "PATCH" : "POST", body: JSON.stringify(data) },
      );
      onSaved(result);
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "scope 또는 condition의 JSON 형식을 확인해주세요."
          : (e as Error).message,
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={submit} className="entity-form">
      <div className="form-body">
        {error && <ErrorNotice message={error} />}
        <div className="form-grid">
          {collection !== "expressions" && (
            <div className="field full">
              <Label htmlFor="entity-name">
                {labels[collection].singular}명 *
              </Label>
              <Input
                id="entity-name"
                name="name"
                defaultValue={field("name")}
                required
                maxLength={500}
                placeholder={
                  collection === "terms"
                    ? "예: 고객번호"
                    : "예: 고객번호 형식 검증"
                }
              />
            </div>
          )}
          {collection === "terms" && (
            <>
              <div className="field full">
                <Label htmlFor="definition">정의 *</Label>
                <Textarea
                  id="definition"
                  name="definition"
                  defaultValue={field("definition")}
                  required
                  rows={3}
                  maxLength={12000}
                  placeholder="용어의 의미와 사용 목적을 설명하세요."
                />
              </div>
              <div className="field">
                <Label htmlFor="domain">도메인 *</Label>
                <Input
                  id="domain"
                  name="domain"
                  defaultValue={field("domain") ?? "CUSTOMER"}
                  required
                  maxLength={500}
                />
              </div>
            </>
          )}
          {collection !== "terms" && (
            <TermPicker initial={entity} onChange={setTermId} />
          )}
          {collection === "expressions" && (
            <>
              <div className="field full">
                <Label htmlFor="text">표현 *</Label>
                <Input
                  id="text"
                  name="text"
                  defaultValue={field("text")}
                  required
                  maxLength={500}
                  placeholder="예: 고객 ID"
                />
              </div>
              <div className="field">
                <Label htmlFor="expression-type">표현 유형</Label>
                <NativeSelect
                  id="expression-type"
                  name="type"
                  defaultValue={field("type") ?? "ALIAS"}
                >
                  {expressionTypes.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </NativeSelect>
              </div>
            </>
          )}
          {collection === "rules" && (
            <>
              <div className="field full">
                <Label htmlFor="description">설명 *</Label>
                <Textarea
                  id="description"
                  name="description"
                  defaultValue={field("description")}
                  required
                  rows={3}
                  maxLength={12000}
                />
              </div>
              <div className="field">
                <Label htmlFor="rule-type">규칙 유형</Label>
                <NativeSelect
                  id="rule-type"
                  value={ruleType}
                  onChange={(e) =>
                    setRuleType(e.target.value as typeof ruleType)
                  }
                >
                  {ruleTypes.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </NativeSelect>
              </div>
              <div className="field">
                <Label htmlFor="priority">우선순위</Label>
                <Input
                  id="priority"
                  name="priority"
                  type="number"
                  step="1"
                  required
                  defaultValue={entity?.priority ?? 100}
                />
              </div>
              <div className="form-section full">
                <h3>
                  Condition <small>규칙 정의 · 실행하지 않음</small>
                </h3>
                <div key={ruleType}>
                  {(ruleType === "FORMAT" || ruleType === "MASKING") && (
                    <div className="field">
                      <Label htmlFor="pattern">
                        {ruleType === "FORMAT"
                          ? "정규식"
                          : "매칭 패턴 (정규식)"}{" "}
                        *
                      </Label>
                      <Input
                        id="pattern"
                        name="pattern"
                        defaultValue={String(condition.pattern ?? "")}
                        required
                        placeholder={
                          ruleType === "FORMAT"
                            ? "^CUST-[0-9]{10}$"
                            : "^([0-9]{6})-?[0-9]{7}$"
                        }
                      />
                    </div>
                  )}
                  {ruleType === "MASKING" && (
                    <div className="form-grid" style={{ marginTop: 18 }}>
                      <div className="field full">
                        <Label htmlFor="replacement">치환 형식 *</Label>
                        <Input
                          id="replacement"
                          name="replacement"
                          required
                          maxLength={2000}
                          defaultValue={String(
                            entity?.action?.replacement ?? "",
                          )}
                          placeholder="$1-*******"
                        />
                        <p className="muted small-text">
                          $1은 매칭 패턴의 첫 번째 캡처 그룹입니다. 정규식이
                          아닌 치환 문자열을 입력하세요.
                        </p>
                      </div>
                      <div className="field full">
                        <Label htmlFor="resultPattern">
                          수정 완료 패턴 (정규식) *
                        </Label>
                        <Input
                          id="resultPattern"
                          name="resultPattern"
                          required
                          maxLength={2000}
                          defaultValue={String(
                            entity?.action?.resultPattern ?? "",
                          )}
                          placeholder={"^[0-9]{6}-\\*{7}$"}
                        />
                        <p className="muted small-text">
                          이미 마스킹됐거나 수정이 끝난 값의 형식입니다. 실제
                          치환·완료 판정은 별도 평가 엔진에서 수행합니다.
                        </p>
                      </div>
                    </div>
                  )}
                  {ruleType === "REQUIRED" && (
                    <p className="muted">
                      대상 값이 존재해야 한다는 규칙을 저장합니다.
                    </p>
                  )}
                  {ruleType === "ENUM" && (
                    <div className="field">
                      <Label htmlFor="values">허용값 · 한 줄에 하나씩 *</Label>
                      <Textarea
                        id="values"
                        name="values"
                        defaultValue={
                          Array.isArray(condition.values)
                            ? condition.values.join("\n")
                            : ""
                        }
                        required
                        rows={3}
                      />
                    </div>
                  )}
                  {ruleType === "RANGE" && (
                    <div className="form-grid">
                      <div className="field">
                        <Label htmlFor="min">최솟값 *</Label>
                        <Input
                          id="min"
                          name="min"
                          type="number"
                          step="any"
                          required
                          defaultValue={Number(condition.min ?? 0)}
                        />
                      </div>
                      <div className="field">
                        <Label htmlFor="max">최댓값 *</Label>
                        <Input
                          id="max"
                          name="max"
                          type="number"
                          step="any"
                          required
                          defaultValue={Number(condition.max ?? 100)}
                        />
                      </div>
                    </div>
                  )}
                  {["CUSTOM", "PROHIBITED", "RELATION"].includes(ruleType) && (
                    <div className="field">
                      <Label htmlFor="condition">Condition JSON *</Label>
                      <Textarea
                        id="condition"
                        name="condition"
                        defaultValue={JSON.stringify(condition, null, 2)}
                        required
                        rows={4}
                      />
                    </div>
                  )}
                </div>
              </div>
              <div className="field full">
                <Label htmlFor="scope">적용 범위 · Scope JSON</Label>
                <Textarea
                  id="scope"
                  name="scope"
                  defaultValue={JSON.stringify(entity?.scope ?? {}, null, 2)}
                  required
                  rows={2}
                />
              </div>
              <div className="field">
                <Label htmlFor="onViolation">위반 시 조치</Label>
                <NativeSelect
                  id="onViolation"
                  name="onViolation"
                  defaultValue={String(entity?.action?.onViolation ?? "REPORT")}
                >
                  {["REPORT", "BLOCK", "WARN"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </NativeSelect>
              </div>
              <div className="field">
                <Label htmlFor="severity">심각도</Label>
                <NativeSelect
                  id="severity"
                  name="severity"
                  defaultValue={String(entity?.action?.severity ?? "MEDIUM")}
                >
                  {["LOW", "MEDIUM", "HIGH"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </NativeSelect>
              </div>
            </>
          )}
          <div className="field">
            <Label htmlFor="status">상태</Label>
            <NativeSelect
              id="status"
              name="status"
              defaultValue={entity?.status ?? "ACTIVE"}
            >
              {statuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <p className="form-help">
          저장 후 검색 인덱스에 반영되기까지 시간이 걸릴 수 있습니다.
        </p>
      </div>
      <div className="form-actions">
        <Button
          variant="ghost"
          type="button"
          className="button secondary"
          onClick={onCancel}
        >
          취소
        </Button>
        <Button variant="default" className="button primary" disabled={saving}>
          {saving
            ? "저장 중…"
            : entity
              ? "변경사항 저장"
              : `${labels[collection].singular} 만들기`}
        </Button>
      </div>
    </form>
  );
}
