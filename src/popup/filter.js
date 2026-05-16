/**
 * Filter view module.
 *
 * Owns the filter view: rule list, rule creator (chips and inputs),
 * delete confirmation, filtered-notifications drawer, and the badge that
 * indicates how many notifications were hidden by the rules.
 *
 * popup.js wires this up by passing in the cross-view helpers it controls
 * (toggleOverlayView, mainView). Rendering goes directly through the shared
 * notification-renderer module.
 */

import { MESSAGE_TYPES } from "../lib/constants.js";
import { isVisible } from "../lib/filter-rules.js";
import { parseSVG } from "../lib/icons.js";
import { buildRepoNotificationsUrl, buildKeywordNotificationsUrl } from "../lib/url-builder.js";
import {
  renderNotifications,
  renderNotificationsInto,
  groupByRepo,
} from "./notification-renderer.js";

const DELETE_CONFIRMATION_TIMEOUT_MS = 5000;

/**
 * Create the filter view controller.
 *
 * @param {Object} deps
 * @param {Function} deps.sendMessage - send message to background worker
 * @param {Object} deps.storage - storage module (getNotifications, getNotificationFilterStats)
 * @param {Function} deps.toggleOverlayView - show/hide overlay (header/footer/main list)
 * @param {HTMLElement} deps.mainView - main popup view (filter overlay sizing target)
 * @returns {Object} filter API
 */
export function createFilter(deps) {
  const { sendMessage, storage, toggleOverlayView, mainView } = deps;

  // ─── DOM ──────────────────────────────────────────────────────────────
  const filterIconBtn = document.getElementById("filter-icon-btn");
  const filterView = document.getElementById("filter-view");
  const filterBackBtn = document.getElementById("filter-back-btn");
  const filterRulesList = document.getElementById("filter-rules-list");
  const filterAddRuleBtn = document.getElementById("filter-add-rule-btn");
  const filterCreator = document.getElementById("filter-creator");
  const filterCreatorToggle = document.getElementById("filter-creator-toggle");
  const filterCreatorLabel = document.getElementById("filter-creator-label");
  const filterHeader = filterView?.querySelector(".settings-header");
  const filterContent = filterView?.querySelector(".filter-content");
  const filterNewRepoChips = document.getElementById("filter-new-repo-chips");
  const filterNewRepoInput = document.getElementById("filter-new-repo-input");
  const filterNewRepoAdd = document.getElementById("filter-new-repo-add");
  const filterNewKwChips = document.getElementById("filter-new-kw-chips");
  const filterNewKwInput = document.getElementById("filter-new-kw-input");
  const filterNewKwAdd = document.getElementById("filter-new-kw-add");
  const filterErrorEl = document.getElementById("filter-error");
  const filterCountBadge = document.getElementById("filter-count-badge");
  const filteredNotificationsContainer = document.getElementById(
    "filtered-notifications-container",
  );
  const filteredNotificationsList = document.getElementById("notifications-list-filtered");

  // ─── State ────────────────────────────────────────────────────────────
  let currentFilterRules = [];
  let currentFilterStats = [];
  const newRule = { repos: [], keywords: [] };
  const pendingNewRuleChipEdits = { repo: null, kw: null };
  let editingRuleIndex = -1;
  let confirmingDeleteIndex = -1;
  let confirmingDeleteTimer = null;
  let showingFiltered = false;
  let creatorWasOpen = false;
  let syncHeightScheduled = false;

  // ─── Geometry / layout ────────────────────────────────────────────────
  function parsePixelValue(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function syncFilterOverlayHeight(force = false) {
    if (!force && syncHeightScheduled) return;
    syncHeightScheduled = true;
    queueMicrotask(() => {
      syncHeightScheduled = false;
      if (
        !mainView ||
        !filterView ||
        filterView.hidden ||
        !mainView.classList.contains("filter-active")
      ) {
        return;
      }
      const bodyStyles = getComputedStyle(document.body);
      const minHeight = parsePixelValue(bodyStyles.minHeight) ?? 300;
      const maxHeight =
        parsePixelValue(bodyStyles.maxHeight) ??
        Math.max(minHeight, Math.round(mainView.getBoundingClientRect().height));
      const headerHeight = filterHeader?.offsetHeight ?? 0;
      const contentHeight = filterContent?.scrollHeight ?? 0;
      const overlayHeight = Math.min(maxHeight, Math.max(minHeight, headerHeight + contentHeight));
      mainView.style.setProperty("--filter-overlay-height", `${overlayHeight}px`);
    });
  }

  function setFilterLayoutState(isOpen) {
    if (!mainView) return;
    if (!isOpen) {
      mainView.style.removeProperty("--filter-overlay-height");
    }
    mainView.classList.toggle("filter-active", isOpen);
  }

  function scrollFilterCreatorIntoView() {
    if (!filterContent || !filterCreator || filterCreator.hidden) return;
    requestAnimationFrame(() => {
      if (filterCreator.hidden) return;
      const contentRect = filterContent.getBoundingClientRect();
      const creatorRect = filterCreator.getBoundingClientRect();
      const top = Math.max(creatorRect.top - contentRect.top + filterContent.scrollTop - 8, 0);
      if (typeof filterContent.scrollTo === "function") {
        filterContent.scrollTo({ top, behavior: "smooth" });
      } else {
        filterContent.scrollTop = top;
      }
    });
  }

  // ─── Chip / row rendering ─────────────────────────────────────────────
  function createChip(value, variant, options = {}) {
    const { onEdit, onRemove } = options;
    const chip = document.createElement("span");
    chip.className = `filter-chip filter-chip-${variant}`;

    const label = document.createElement(onEdit ? "button" : "span");
    label.className = "filter-chip-label";
    label.textContent = value;
    if (onEdit) {
      label.type = "button";
      label.classList.add("filter-chip-edit-trigger");
      label.title = `Edit "${value}"`;
      label.setAttribute("aria-label", `Edit ${value}`);
      label.addEventListener("click", () => onEdit(value));
    }
    chip.appendChild(label);

    if (onRemove) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "filter-chip-remove";
      removeBtn.title = `Remove "${value}"`;
      removeBtn.setAttribute("aria-label", `Remove ${value}`);
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => onRemove(value));
      chip.appendChild(removeBtn);
    }
    return chip;
  }

  function createFilterRuleActionButton({
    className,
    title,
    ariaLabel,
    svgMarkup,
    disabled = false,
    onClick,
  }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn-icon filter-rule-action-btn ${className}`;
    button.title = title;
    button.setAttribute("aria-label", ariaLabel);
    button.disabled = disabled;
    button.appendChild(parseSVG(svgMarkup));
    button.addEventListener("click", onClick);
    return button;
  }

  function clearDeleteConfirmationTimer() {
    if (confirmingDeleteTimer !== null) {
      clearTimeout(confirmingDeleteTimer);
      confirmingDeleteTimer = null;
    }
  }

  function exitDeleteConfirmation(row, actions, editBtn) {
    clearDeleteConfirmationTimer();
    confirmingDeleteIndex = -1;
    row.classList.remove("confirming-delete");
    actions.querySelectorAll(".confirm-delete, .cancel-delete").forEach((el) => el.remove());
    editBtn.hidden = false;
    actions.querySelector(".filter-rule-remove-btn").hidden = false;
  }

  function enterDeleteConfirmation(idx, row, actions, editBtn) {
    if (confirmingDeleteIndex >= 0 && confirmingDeleteIndex !== idx) {
      const prevRow = filterRulesList?.querySelectorAll(".filter-rule-row")[confirmingDeleteIndex];
      if (prevRow?.classList.contains("confirming-delete")) {
        const prevActions = prevRow.querySelector(".filter-rule-actions");
        const prevEditBtn = prevRow.querySelector(".filter-rule-edit-btn");
        exitDeleteConfirmation(prevRow, prevActions, prevEditBtn);
      }
    }

    confirmingDeleteIndex = idx;
    row.classList.add("confirming-delete");
    editBtn.hidden = true;
    actions.querySelector(".filter-rule-remove-btn").hidden = true;

    const confirmBtn = createFilterRuleActionButton({
      className: "confirm-delete",
      title: "Confirm delete",
      ariaLabel: "Confirm delete",
      svgMarkup:
        '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>',
      onClick: () => executeDeleteRule(idx),
    });

    const cancelBtn = createFilterRuleActionButton({
      className: "cancel-delete",
      title: "Cancel",
      ariaLabel: "Cancel delete",
      svgMarkup:
        '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>',
      onClick: () => exitDeleteConfirmation(row, actions, editBtn),
    });

    actions.append(confirmBtn, cancelBtn);
    confirmBtn.focus();

    clearDeleteConfirmationTimer();
    confirmingDeleteTimer = setTimeout(() => {
      confirmingDeleteTimer = null;
      if (confirmingDeleteIndex === idx) {
        exitDeleteConfirmation(row, actions, editBtn);
      }
    }, DELETE_CONFIRMATION_TIMEOUT_MS);
  }

  async function executeDeleteRule(idx) {
    clearDeleteConfirmationTimer();
    confirmingDeleteIndex = -1;
    const updated = [...currentFilterRules];
    updated.splice(idx, 1);
    if (!(await saveFilterRules(updated))) {
      renderRuleRows(currentFilterRules, currentFilterStats);
      return;
    }
    currentFilterRules = updated;
    if (editingRuleIndex >= 0) {
      if (idx === editingRuleIndex) {
        hideCreator();
      } else if (idx < editingRuleIndex) {
        editingRuleIndex--;
      }
    }
    currentFilterStats = await storage.getNotificationFilterStats();
    renderRuleRows(currentFilterRules, currentFilterStats);
    updateFilterIndicator(currentFilterRules);
  }

  function renderRuleRows(rules, stats = []) {
    if (!filterRulesList) return;
    clearDeleteConfirmationTimer();
    confirmingDeleteIndex = -1;
    filterRulesList.replaceChildren();

    if (rules.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const svgMarkup =
        '<svg viewBox="0 0 16 16" width="24" height="24"><path fill="currentColor" d="M.75 3h14.5a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1 0-1.5ZM3 7.75A.75.75 0 0 1 3.75 7h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 3 7.75Zm3 4a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"/></svg>';
      empty.appendChild(parseSVG(svgMarkup));
      const text = document.createElement("p");
      text.textContent = "No rules yet";
      empty.appendChild(text);
      filterRulesList.appendChild(empty);
      syncFilterOverlayHeight();
      return;
    }

    rules.forEach((rule, idx) => {
      const row = document.createElement("div");
      row.className = "filter-rule-row";
      const isEditing = idx === editingRuleIndex;
      if (isEditing) {
        row.classList.add("is-editing");
        row.setAttribute("aria-current", "true");
      }

      const chips = document.createElement("div");
      chips.className = "filter-rule-chips";

      const ruleStats = stats[idx] || {};
      const repoStats = ruleStats.repos || {};
      const kwStats = ruleStats.keywords || {};

      rule.repos.forEach((repo) => {
        const group = document.createElement("span");
        group.className = "filter-chip-group";

        const link = document.createElement("a");
        link.className = "filter-chip filter-chip-repo filter-chip-link";
        link.href = buildRepoNotificationsUrl(repo);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.title = `Open ${repo} notifications`;
        link.textContent = repo;
        group.appendChild(link);

        const count = repoStats[repo.toLowerCase()] || 0;
        if (count > 0) {
          const countEl = document.createElement("span");
          countEl.className = "filter-chip-count";
          countEl.textContent = count;
          countEl.title = `${count} notification${count === 1 ? "" : "s"} filtered from last refresh`;
          group.appendChild(countEl);
        }
        chips.appendChild(group);
      });

      if (rule.repos.length > 0 && rule.keywords.length > 0) {
        const sep = document.createElement("span");
        sep.className = "filter-rule-sep";
        sep.textContent = "+";
        chips.appendChild(sep);
      }

      rule.keywords.forEach((kw) => {
        const group = document.createElement("span");
        group.className = "filter-chip-group";

        const link = document.createElement("a");
        link.className = "filter-chip filter-chip-kw filter-chip-link";
        link.href = buildKeywordNotificationsUrl(kw);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.title = `Search notifications for "${kw}"`;
        link.textContent = kw;
        group.appendChild(link);

        const kwCount = kwStats[kw] || 0;
        if (kwCount > 0) {
          const countEl = document.createElement("span");
          countEl.className = "filter-chip-count";
          countEl.textContent = kwCount;
          countEl.title = `${kwCount} notification${kwCount === 1 ? "" : "s"} matched "${kw}" from last refresh`;
          group.appendChild(countEl);
        }
        chips.appendChild(group);
      });

      const actions = document.createElement("div");
      actions.className = "filter-rule-actions";

      const editBtn = createFilterRuleActionButton({
        className: "filter-rule-edit-btn",
        title: isEditing ? "Editing current rule" : "Edit rule",
        ariaLabel: isEditing ? "Editing current rule" : "Edit rule",
        disabled: isEditing,
        svgMarkup:
          '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M11.013 1.427a1.75 1.75 0 0 1 2.474 2.474l-7.25 7.25a1.75 1.75 0 0 1-.77.444l-2.16.54a.75.75 0 0 1-.91-.91l.54-2.16a1.75 1.75 0 0 1 .444-.77l7.25-7.25Zm1.414 1.06a.25.25 0 0 0-.353 0l-1.344 1.344 1.414 1.414 1.344-1.344a.25.25 0 0 0 0-.353l-1.06-1.06Zm-1.767 3.112L9.246 4.185 3.442 9.99a.25.25 0 0 0-.064.112l-.295 1.179 1.179-.295a.25.25 0 0 0 .112-.064l6.35-6.423Z"/></svg>',
        onClick: () => editRule(idx),
      });

      const removeBtn = createFilterRuleActionButton({
        className: "filter-rule-remove-btn",
        title: "Remove rule",
        ariaLabel: "Remove rule",
        svgMarkup:
          '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6.5 1.75A1.75 1.75 0 0 1 8.25 0h1.5A1.75 1.75 0 0 1 11.5 1.75V2h2.25a.75.75 0 0 1 0 1.5h-.638l-.622 9.066A1.75 1.75 0 0 1 10.744 14H5.256a1.75 1.75 0 0 1-1.746-1.434L2.888 3.5H2.25a.75.75 0 0 1 0-1.5H5v-.25Zm1.5-.25a.25.25 0 0 0-.25.25V2h2v-.25a.25.25 0 0 0-.25-.25H8Zm-2.108 11h4.216a.25.25 0 0 0 .249-.228L10.964 3.5H5.036l.607 8.772a.25.25 0 0 0 .249.228ZM6.75 5.75a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V6.5a.75.75 0 0 1 .75-.75Zm2.5 0a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V6.5a.75.75 0 0 1 .75-.75Z"/></svg>',
        onClick: () => enterDeleteConfirmation(idx, row, actions, editBtn),
      });

      actions.append(editBtn, removeBtn);
      row.append(chips, actions);
      filterRulesList.appendChild(row);
    });

    syncFilterOverlayHeight();
  }

  // ─── Creator form ─────────────────────────────────────────────────────
  function getNewRuleFieldParts(field) {
    return {
      key: field === "repo" ? "repos" : "keywords",
      input: field === "repo" ? filterNewRepoInput : filterNewKwInput,
    };
  }

  function findNewRuleValueIndex(list, value) {
    const exactIndex = list.indexOf(value);
    if (exactIndex >= 0) return exactIndex;
    const normalized = value.toLowerCase();
    return list.findIndex((entry) => entry.toLowerCase() === normalized);
  }

  function updateFilterCreatorSaveState() {
    if (!filterAddRuleBtn) return;
    const hasKeywords = newRule.keywords.length > 0 || Boolean(filterNewKwInput?.value.trim());
    filterAddRuleBtn.disabled = !hasKeywords;
  }

  function updateFilterCreatorLabel() {
    if (!filterCreatorLabel) return;
    filterCreatorLabel.textContent = editingRuleIndex >= 0 ? "Edit Rule" : "New Rule";
  }

  function renderNewRuleChips(field) {
    const { key } = getNewRuleFieldParts(field);
    const container = field === "repo" ? filterNewRepoChips : filterNewKwChips;
    if (!container) return;
    container.replaceChildren(
      ...newRule[key].map((v) =>
        createChip(v, field, {
          onEdit: (selected) => editNewRuleChip(field, selected),
          onRemove: (removed) => {
            newRule[key] = newRule[key].filter((r) => r !== removed);
            renderNewRuleChips(field);
          },
        }),
      ),
    );
    updateFilterCreatorSaveState();
    syncFilterOverlayHeight();
  }

  function reconcileCreatorChips(field, value) {
    const { key, input } = getNewRuleFieldParts(field);
    const pending = pendingNewRuleChipEdits[field];

    pendingNewRuleChipEdits[field] = null;
    if (input) input.value = "";

    if (value && findNewRuleValueIndex(newRule[key], value) === -1) {
      const insertIndex = pending?.index ?? newRule[key].length;
      newRule[key].splice(Math.min(insertIndex, newRule[key].length), 0, value);
    }

    renderNewRuleChips(field);
  }

  function commitCreatorInput(field) {
    const { input } = getNewRuleFieldParts(field);
    const draft = input?.value.trim() || "";
    reconcileCreatorChips(field, draft);
  }

  function discardPendingEdit(field) {
    const pending = pendingNewRuleChipEdits[field];
    reconcileCreatorChips(field, pending?.value ?? "");
  }

  function editNewRuleChip(field, value) {
    const { key, input } = getNewRuleFieldParts(field);
    discardPendingEdit(field);

    const valueIndex = findNewRuleValueIndex(newRule[key], value);
    if (valueIndex === -1) return;

    pendingNewRuleChipEdits[field] = { value, index: valueIndex };
    newRule[key].splice(valueIndex, 1);
    renderNewRuleChips(field);

    if (input) {
      input.value = value;
      input.focus();
      const cursorOffset = input.value.length;
      input.setSelectionRange(cursorOffset, cursorOffset);
    }
    updateFilterCreatorSaveState();
  }

  function openCreatorForm() {
    pendingNewRuleChipEdits.repo = null;
    pendingNewRuleChipEdits.kw = null;
    if (filterNewRepoInput) filterNewRepoInput.value = "";
    if (filterNewKwInput) filterNewKwInput.value = "";
    renderNewRuleChips("repo");
    renderNewRuleChips("kw");
    updateFilterCreatorLabel();
    if (filterCreator) filterCreator.hidden = false;
    if (filterCreatorToggle) filterCreatorToggle.textContent = "Cancel";
    if (filterAddRuleBtn) filterAddRuleBtn.hidden = false;
    filterNewRepoInput?.focus();
  }

  function showCreator() {
    editingRuleIndex = -1;
    newRule.repos = [];
    newRule.keywords = [];
    openCreatorForm();
    renderRuleRows(currentFilterRules, currentFilterStats);
    scrollFilterCreatorIntoView();
  }

  function editRule(index) {
    const rule = currentFilterRules[index];
    if (!rule) return;
    editingRuleIndex = index;
    newRule.repos = [...rule.repos];
    newRule.keywords = [...rule.keywords];
    openCreatorForm();
    renderRuleRows(currentFilterRules, currentFilterStats);
    scrollFilterCreatorIntoView();
  }

  function hideCreator() {
    editingRuleIndex = -1;
    newRule.repos = [];
    newRule.keywords = [];
    pendingNewRuleChipEdits.repo = null;
    pendingNewRuleChipEdits.kw = null;
    if (filterNewRepoInput) filterNewRepoInput.value = "";
    if (filterNewKwInput) filterNewKwInput.value = "";
    updateFilterCreatorLabel();
    if (filterCreator) filterCreator.hidden = true;
    if (filterCreatorToggle) filterCreatorToggle.textContent = "+ New Rule";
    if (filterAddRuleBtn) filterAddRuleBtn.hidden = true;
    updateFilterCreatorSaveState();
    renderRuleRows(currentFilterRules, currentFilterStats);
    requestAnimationFrame(() => syncFilterOverlayHeight(true));
  }

  function addToNewRule(field) {
    const { input } = getNewRuleFieldParts(field);
    commitCreatorInput(field);
    input?.focus();
  }

  async function submitNewRule() {
    commitCreatorInput("repo");
    commitCreatorInput("kw");
    if (newRule.keywords.length === 0) return;
    const updatedRule = { repos: [...newRule.repos], keywords: [...newRule.keywords] };
    let updated;
    if (editingRuleIndex >= 0) {
      updated = currentFilterRules.map((r, i) => (i === editingRuleIndex ? updatedRule : r));
    } else {
      updated = [...currentFilterRules, updatedRule];
    }
    if (!(await saveFilterRules(updated))) return;
    currentFilterRules = updated;
    currentFilterStats = await storage.getNotificationFilterStats();
    hideCreator();
    updateFilterIndicator(currentFilterRules);
  }

  // ─── Filter persistence + indicators ──────────────────────────────────
  async function saveFilterRules(rules) {
    try {
      const result = await sendMessage(MESSAGE_TYPES.SET_NOTIFICATION_FILTER, { filter: rules });
      if (result?.error) throw new Error(result.error);
      if (filterErrorEl) filterErrorEl.hidden = true;
      if (showingFiltered) renderFilteredInFilterView();
      syncFilterOverlayHeight();
      return true;
    } catch (err) {
      console.error("Failed to save notification filter:", err);
      if (filterErrorEl) {
        filterErrorEl.textContent = "Failed to save filter. Please try again.";
        filterErrorEl.hidden = false;
      }
      syncFilterOverlayHeight();
      return false;
    }
  }

  function updateFilterIndicator(rules) {
    if (!filterIconBtn) return;
    const isActive = rules.some((r) => r.repos.length > 0 || r.keywords.length > 0);
    filterIconBtn.classList.toggle("filter-active", isActive);
  }

  function updateFilteredBadge(count) {
    if (!filterCountBadge) return;
    if (count === 0) {
      filterCountBadge.hidden = true;
      filterCountBadge.textContent = "";
      if (showingFiltered) {
        showingFiltered = false;
        if (filteredNotificationsContainer) filteredNotificationsContainer.hidden = true;
        if (filterRulesList) filterRulesList.hidden = false;
        if (filterCreator && creatorWasOpen) filterCreator.hidden = false;
        syncFilterOverlayHeight(true);
      }
    } else {
      filterCountBadge.textContent = `· ${count} filtered`;
      filterCountBadge.hidden = false;
    }
  }

  // ─── Rendering with filtered split ────────────────────────────────────
  function renderWithFiltered(notifications, shouldResort) {
    const visible = [];
    const filtered = [];
    for (const n of notifications) {
      if (isVisible(n)) visible.push(n);
      else filtered.push(n);
    }
    renderNotifications(visible, shouldResort);
    updateFilteredBadge(filtered.length);
  }

  async function refreshFilteredBadge() {
    const stored = await storage.getNotifications();
    const filtered = stored.filter((n) => !isVisible(n));
    updateFilteredBadge(filtered.length);
    return filtered;
  }

  async function renderFilteredInFilterView() {
    if (!filteredNotificationsList) return;
    const filtered = await refreshFilteredBadge();
    renderNotificationsInto(filteredNotificationsList, groupByRepo(filtered));
  }

  async function toggleFilteredInFilterView() {
    if (!filterRulesList || !filteredNotificationsContainer) return;

    showingFiltered = !showingFiltered;

    if (showingFiltered) {
      creatorWasOpen = filterCreator && !filterCreator.hidden;
      filterRulesList.hidden = true;
      if (filterCreator) filterCreator.hidden = true;
      await renderFilteredInFilterView();
      filteredNotificationsContainer.hidden = false;
    } else {
      filteredNotificationsContainer.hidden = true;
      filterRulesList.hidden = false;
      if (filterCreator && creatorWasOpen) filterCreator.hidden = false;
    }
    syncFilterOverlayHeight(true);
  }

  // ─── View open / close ────────────────────────────────────────────────
  async function show() {
    let loadError = false;
    try {
      const result = await sendMessage(MESSAGE_TYPES.GET_NOTIFICATION_FILTER);
      currentFilterRules = Array.isArray(result?.filter) ? result.filter : [];
    } catch (err) {
      console.error("Failed to load notification filter:", err);
      currentFilterRules = [];
      loadError = true;
    }

    try {
      currentFilterStats = await storage.getNotificationFilterStats();
    } catch {
      currentFilterStats = [];
    }

    setFilterLayoutState(true);
    toggleOverlayView(true);
    if (filterView) filterView.hidden = false;

    if (filterErrorEl) {
      if (loadError) {
        filterErrorEl.textContent = "Failed to load filter rules.";
        filterErrorEl.hidden = false;
      } else {
        filterErrorEl.hidden = true;
      }
    }

    hideCreator();
  }

  async function hide() {
    showingFiltered = false;
    if (filteredNotificationsContainer) filteredNotificationsContainer.hidden = true;
    if (filterRulesList) filterRulesList.hidden = false;
    toggleOverlayView(false);
    if (filterView) filterView.hidden = true;
    setFilterLayoutState(false);
    try {
      const stored = await storage.getNotifications();
      renderWithFiltered(stored, false);
    } catch (err) {
      console.error("Failed to reload notifications after closing filter:", err);
      renderNotifications([], false);
    }
  }

  // ─── Storage change wiring (filter stats live update) ─────────────────
  function handleStorageChange(changes, areaName) {
    if (
      areaName === "local" &&
      changes.notificationFilterStats &&
      filterView &&
      !filterView.hidden
    ) {
      currentFilterStats = changes.notificationFilterStats.newValue || [];
      renderRuleRows(currentFilterRules, currentFilterStats);
    }
  }

  // ─── Mark-all-as-read cleanup hook ────────────────────────────────────
  function clearFilteredAfterMarkAll() {
    updateFilteredBadge(0);
  }

  // ─── Event wiring ─────────────────────────────────────────────────────
  filterIconBtn?.addEventListener("click", show);
  filterCountBadge?.addEventListener("click", toggleFilteredInFilterView);
  filterBackBtn?.addEventListener("click", hide);
  filterCreatorToggle?.addEventListener("click", () => {
    if (filterCreator?.hidden !== false) {
      showCreator();
    } else {
      hideCreator();
    }
  });
  filterAddRuleBtn?.addEventListener("click", submitNewRule);
  filterNewRepoAdd?.addEventListener("click", () => addToNewRule("repo"));
  filterNewKwAdd?.addEventListener("click", () => addToNewRule("kw"));
  filterNewRepoInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addToNewRule("repo");
  });
  filterNewKwInput?.addEventListener("input", updateFilterCreatorSaveState);
  filterNewKwInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addToNewRule("kw");
  });

  return {
    show,
    hide,
    renderWithFiltered,
    refreshFilteredBadge,
    renderFilteredInFilterView,
    updateFilterIndicator,
    handleStorageChange,
    clearFilteredAfterMarkAll,
    applyPulledFilter(rules) {
      currentFilterRules = rules;
      currentFilterStats = [];
      renderRuleRows(currentFilterRules, currentFilterStats);
      updateFilterIndicator(currentFilterRules);
    },
    isShowingFiltered() {
      return showingFiltered;
    },
  };
}
