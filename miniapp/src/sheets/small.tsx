import { useState } from "preact/hooks";
import { Icon, Sheet, SheetHead } from "../components/ui";
import { del, patch, post, uuid7 } from "../lib/api";
import { haptic } from "../lib/haptic";
import { closeSheet } from "../lib/router";
import { mutate, resource, setData } from "../lib/store";
import { toast } from "../lib/toast";
import type { Me } from "../lib/types";

export function SphereSheet({ id, name: initial }: { id?: string; name?: string }) {
  const [name, setName] = useState(initial ?? "");
  const [confirmDel, setConfirmDel] = useState(false);
  const refresh = ["/spheres", "/views"];
  const save = async () => {
    if (!name.trim()) return toast("Напиши название сферы");
    const res = await mutate({
      request: () => (id ? patch(`/spheres/${id}`, { name: name.trim() }) : post("/spheres", { id: uuid7(), name: name.trim() })),
      refresh,
    });
    if (res !== undefined) {
      haptic.success();
      closeSheet();
    }
  };
  return (
    <Sheet label="Сфера">
      <SheetHead title={id ? "Сфера" : "Новая сфера"} done="Готово" onDone={save} />
      <div class="sheet-body">
        <div class="grp">
          <label class="row">
            <span class="sr">Название</span>
            <input class="field" style={{ fontSize: "17px" }} placeholder="Например: Здоровье" value={name} maxLength={40} autoFocus onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
        </div>
        <div class="s">Сферы группируют привычки, задачи и цели. В «Итогах» по ним считаются серии.</div>
        {id && (
          <button
            class="btn lg danger"
            onClick={async () => {
              if (!confirmDel) {
                haptic.warning();
                return setConfirmDel(true);
              }
              await mutate({ request: () => del(`/spheres/${id}`), refresh });
              closeSheet();
              toast("Сфера удалена — привычки и задачи остались");
            }}
          >
            {confirmDel ? "Точно удалить сферу?" : "Удалить сферу"}
          </button>
        )}
      </div>
    </Sheet>
  );
}

export function ProfileSheet() {
  const me = resource<Me>("/me").value.data;
  const [name, setName] = useState(me?.first_name ?? "");
  const [motto, setMotto] = useState(me?.motto ?? "");
  const save = async () => {
    if (!name.trim()) return toast("Имя не может быть пустым");
    const fields = { first_name: name.trim(), motto: motto.trim() || null };
    const res = await mutate({
      apply: () => setData<Me>("/me", (m) => ({ ...m, ...fields })),
      request: () => patch("/me", fields),
    });
    if (res !== undefined) closeSheet();
  };
  return (
    <Sheet label="Профиль">
      <SheetHead title="Профиль" done="Готово" onDone={save} />
      <div class="sheet-body">
        <div class="grp">
          <label class="row">
            <span class="s" style={{ width: "70px" }}>Имя</span>
            <input class="field" style={{ fontSize: "17px" }} value={name} maxLength={64} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
          <label class="row">
            <span class="s" style={{ width: "70px" }}>Девиз</span>
            <input class="field" style={{ fontSize: "17px" }} placeholder="Зачем тебе трекер" value={motto} maxLength={120} onInput={(e) => setMotto((e.target as HTMLInputElement).value)} />
          </label>
        </div>
      </div>
    </Sheet>
  );
}

/** Reviews from the user's own Claude arrive via MCP in stage 5; for now explain it. */
export function ClaudeSheet() {
  return (
    <Sheet label="Claude">
      <SheetHead title="Разборы от Claude" />
      <div class="sheet-body">
        <div class="note" style={{ alignItems: "center" }}>
          <Icon name="spark" size={22} style={{ color: "var(--accent)" }} />
          <span class="s" style={{ fontSize: "15px", lineHeight: "21px", color: "var(--soft)" }}>
            Подключи своего Claude к трекеру — он будет смотреть твои отметки, сон и задачи и присылать сюда разборы дня и недели.
          </span>
        </div>
        <div class="s">Подключение появится в Профиле → «Подключить Claude».</div>
      </div>
    </Sheet>
  );
}
