<script lang="ts">
  import Pane from "../common/Pane.svelte";
  import { app } from "../../stores/app.svelte";
  import { router } from "../../app/router.svelte";
  import type { Employee, EmployeeProfileValue } from "../../domain/models";
  import {
    activeProfileFields,
    activeProfileSections,
    applyEmployeeProfileValues,
    profileValueForEdit
  } from "../../domain/employeeProfile";
  import { nowTimestamp } from "../../utils/dates";

  let { employee, onclose }: { employee: Employee; onclose: () => void } = $props();
  let initialized = $state(false);
  let values = $state<Record<string, EmployeeProfileValue | "">>({});
  let sections = $derived(activeProfileSections(app.settings));
  let fields = $derived(activeProfileFields(app.settings));

  $effect(() => {
    if (initialized) return;
    const initial: Record<string, EmployeeProfileValue | ""> = {};
    for (const field of fields) initial[field.id] = profileValueForEdit(employee, field);
    values = initial;
    initialized = true;
  });

  function fieldsFor(sectionId: string) {
    return fields.filter((field) => field.sectionId === sectionId);
  }

  function toggleChoice(fieldId: string, option: string, checked: boolean) {
    const current = Array.isArray(values[fieldId]) ? values[fieldId] as string[] : [];
    values[fieldId] = checked ? [...new Set([...current, option])] : current.filter((item) => item !== option);
  }

  async function save() {
    const record = applyEmployeeProfileValues(employee, fields, values);
    record.updatedAt = nowTimestamp();
    await app.putRecord("employees", record, {
      actionType: "updated",
      summary: `Updated profile details for ${employee.displayName}`
    });
    onclose();
  }

  function manageFields() {
    onclose();
    router.go("settings", "employee-profile-fields");
  }
</script>

<Pane title="Edit Profile Details" wide {onclose}>
  <form onsubmit={(event) => { event.preventDefault(); void save(); }}>
    {#each sections as section (section.id)}
      {@const sectionFields = fieldsFor(section.id)}
      {#if sectionFields.length}
        <section class="form-section">
          <h3>{section.label}</h3>
          <div class="form-grid">
            {#each sectionFields as field (field.id)}
              <div class="field" class:wide-field={field.type === "multiline" || field.type === "multi_choice"}>
                <label for={`ep-${field.id}`}>{field.label}</label>
                {#if field.type === "multiline"}
                  <textarea id={`ep-${field.id}`} rows="3" maxlength="10000" value={typeof values[field.id] === "string" ? values[field.id] as string : ""} oninput={(event) => (values[field.id] = event.currentTarget.value)}></textarea>
                {:else if field.type === "boolean"}
                  <select id={`ep-${field.id}`} value={values[field.id] === true ? "yes" : values[field.id] === false ? "no" : ""} onchange={(event) => (values[field.id] = event.currentTarget.value === "yes" ? true : event.currentTarget.value === "no" ? false : "")}>
                    <option value="">(not set)</option><option value="yes">Yes</option><option value="no">No</option>
                  </select>
                {:else if field.type === "choice"}
                  <select id={`ep-${field.id}`} value={typeof values[field.id] === "string" ? values[field.id] as string : ""} onchange={(event) => (values[field.id] = event.currentTarget.value)}>
                    <option value="">(not set)</option>
                    {#each field.options ?? [] as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
                  </select>
                {:else if field.type === "multi_choice"}
                  <fieldset id={`ep-${field.id}`} class="choice-list">
                    {#each field.options ?? [] as option (option.value)}
                      <label><input type="checkbox" checked={Array.isArray(values[field.id]) && (values[field.id] as string[]).includes(option.value)} onchange={(event) => toggleChoice(field.id, option.value, event.currentTarget.checked)} /> {option.label}</label>
                    {/each}
                  </fieldset>
                {:else}
                  <input
                    id={`ep-${field.id}`}
                    type={field.type === "date" ? "date" : field.type === "email" ? "email" : field.type === "url" ? "url" : field.type === "phone" ? "tel" : "text"}
                    maxlength={field.type === "text" ? 500 : undefined}
                    value={typeof values[field.id] === "string" ? values[field.id] as string : ""}
                    oninput={(event) => (values[field.id] = event.currentTarget.value)}
                  />
                {/if}
              </div>
            {/each}
          </div>
        </section>
      {/if}
    {/each}

    <div class="dialog-actions">
      <button type="button" onclick={manageFields}>Manage fields in Settings</button>
      <span class="spacer"></span>
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary">Save</button>
    </div>
  </form>
</Pane>

<style>
  .form-section { margin-top: 1.5rem; }
  .form-section:first-child { margin-top: .2rem; }
  .form-section h3 {
    font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .07em;
    color: var(--text-muted); margin: 0 0 .85rem; padding-bottom: .4rem; border-bottom: 1px solid var(--border);
  }
  .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: .65rem .9rem; }
  .field { display: flex; flex-direction: column; min-width: 0; }
  .wide-field { grid-column: 1 / -1; }
  .field > label { margin: 0 0 .25rem; }
  .field :is(input, select, textarea) { width: 100%; }
  .choice-list { display: flex; flex-wrap: wrap; gap: .35rem .9rem; border: 1px solid var(--border); border-radius: var(--radius); padding: .55rem .7rem; }
  .choice-list label { display: flex; align-items: center; gap: .35rem; margin: 0; font-weight: 400; }
  .choice-list input { width: auto; }
  .dialog-actions { display: flex; align-items: center; gap: .5rem; margin-top: 1.6rem; }
</style>
