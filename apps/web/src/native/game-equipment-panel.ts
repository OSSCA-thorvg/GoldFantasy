import { Rect, button, ButtonStyle, Align, type Context } from '../../../../packages/native-ui/src';
import {
  inventorySlots,
  equipmentSlots,
  equippedItem,
  itemCatalog,
  attackDamage,
  armorProtection,
  type ItemSpec,
} from '../../../../packages/engine/src/equipment';
import { describe } from '../../../../packages/engine/src/building-catalog';
import { distance } from '../../../../packages/engine/src/geometry';
import { canControl } from '../../../../packages/engine/src/faction';
import type { Person } from '../../../../packages/engine/src/person';
import type { GameHudApp } from './game-hud-contract';
import { actionButton } from './hud-actions';

function itemIcon(c: Context, r: Rect, item: ItemSpec | null, placeholder = false, active = false): void {
  const t = c.theme(),
    x = r.x + r.w / 2,
    y = r.y + r.h / 2,
    s = Math.min(r.w, r.h) / 32;
  const ink = active ? t.accentText : placeholder ? t.muted : t.accent;
  const line = (a: number, b: number, d: number, e: number, w = 2) =>
    c.line(x + a * s, y + b * s, x + d * s, y + e * s, ink, w * s);
  if (!item) return;
  if (item.category === 'resource') {
    if (item.id === 'wood') {
      line(-8, 7, 7, -7, 7);
      line(-9, 6, 5, -8, 1);
    } else if (item.id === 'planks') {
      for (const offset of [-7, 0, 7]) {
        line(-10, offset - 2, 10, offset - 2, 1.5);
        line(10, offset - 2, 10, offset + 2, 1.5);
        line(10, offset + 2, -10, offset + 2, 1.5);
        line(-10, offset + 2, -10, offset - 2, 1.5);
        line(-6, offset, 5, offset, 0.8);
      }
    } else if (item.id === 'stone') {
      line(-9, 7, -6, -5);
      line(-6, -5, 4, -9);
      line(4, -9, 10, 5);
      line(10, 5, -9, 7);
      line(-6, -5, 1, 1);
      line(1, 1, 10, 5);
    } else if (item.id === 'cut-stone') {
      for (const [left, top, width] of [
        [-10, 1, 9],
        [1, 1, 9],
        [-6, -7, 12],
      ]) {
        line(left, top, left + width, top, 1.5);
        line(left + width, top, left + width, top + 6, 1.5);
        line(left + width, top + 6, left, top + 6, 1.5);
        line(left, top + 6, left, top, 1.5);
      }
    } else if (item.id === 'bones') {
      line(-7, 6, 7, -6, 5);
      for (const [dx, dy] of [[-9, 4], [-6, 8], [6, -8], [9, -4]])
        c.rect(new Rect(x + (dx - 3) * s, y + (dy - 3) * s, 6 * s, 6 * s), ink, 3 * s);
    } else if (item.id === 'water') {
      line(0, -10, -7, 3);
      line(-7, 3, 0, 9);
      line(0, 9, 7, 3);
      line(7, 3, 0, -10);
    } else c.rect(new Rect(x - 7 * s, y - 7 * s, 14 * s, 14 * s), ink, 7 * s);
  } else if (item.id === 'cap' || item.id === 'helmet') {
    line(-9, 5, -7, -4);
    line(-7, -4, 0, -9);
    line(0, -9, 7, -4);
    line(7, -4, 9, 5);
    line(-10, 5, 10, 5);
    line(0, -8, 0, 3, 1);
  } else if (item.id === 'boots') {
    line(-8, -9, -8, 7);
    line(-8, 7, -1, 7);
    line(-1, 7, -1, 2);
    line(-1, 2, -4, 1);
    line(-4, 1, -4, -9);
    line(2, -9, 2, 7);
    line(2, 7, 10, 7);
    line(10, 7, 9, 2);
    line(9, 2, 6, 1);
    line(6, 1, 6, -9);
  } else if (item.id === 'gloves') {
    line(-6, 9, -9, 0);
    line(-9, 0, -6, -2);
    line(-6, -2, -4, 2);
    line(-4, 2, -4, -8);
    line(-1, -7, -1, 0);
    line(2, -9, 2, 0);
    line(5, -6, 5, 4);
    line(5, 4, 2, 9);
    line(2, 9, -6, 9);
  } else if (item.id === 'shield') {
    line(-9, -8, 9, -8);
    line(9, -8, 7, 4);
    line(7, 4, 0, 10);
    line(0, 10, -7, 4);
    line(-7, 4, -9, -8);
    line(-6, -3, 6, -3, 1);
    line(0, -6, 0, 7, 1);
  } else if (item.id === 'cloak') {
    line(-4, -9, 4, -9);
    line(4, -9, 10, 10);
    line(10, 10, -10, 10);
    line(-10, 10, -4, -9);
    line(-4, -6, 0, -3);
    line(0, -3, 4, -6);
  } else if (item.category === 'armor') {
    line(-9, -7, -3, -10);
    line(-3, -10, 3, -10);
    line(3, -10, 9, -7);
    line(9, -7, 6, 9);
    line(6, 9, -6, 9);
    line(-6, 9, -9, -7);
    line(0, -8, 0, 7, 1);
  } else if (item.visual === 'bow') {
    line(-5, -10, 2, -7);
    line(2, -7, 6, 0);
    line(6, 0, 2, 7);
    line(2, 7, -5, 10);
    line(-5, -10, -5, 10, 1);
    line(-9, 0, 10, 0, 1);
  } else if (item.visual === 'sword' || item.visual === 'staff' || item.visual === 'mace') {
    line(-7, 10, 7, -10, 3);
    line(-8, 4, -2, 9);
    if (item.visual !== 'sword') c.rect(new Rect(x + 2 * s, y - 12 * s, 8 * s, 8 * s), ink, 3 * s);
  } else {
    line(-7, 10, 4, -8, 2);
    if (item.visual === 'hammer') line(-1, -10, 10, -3, 5);
    else if (item.visual === 'axe') {
      line(1, -8, 10, -8, 5);
      line(10, -8, 10, 0, 3);
    } else line(-3, -10, 10, -3, 2);
  }
}

/** Inventory owns real finite stacks; gear slots reference those same stacks. */
export function equipmentPanel(app: GameHudApp, p: Person, panel: Rect): void {
  const c = app.context,
    t = app.theme,
    enabled = canControl(p),
    top = panel.y + 33;
  const tabs = [
    ['equipment', 'gear', 'Equipment'],
    ['craft', 'craft', 'Craft at a workshop'],
  ] as const;
  tabs.forEach(([tab, glyph, label], i) =>
    actionButton(
      c,
      `equipment-tab-${tab}`,
      new Rect(panel.x + i * 48, panel.y, 42, 28),
      glyph,
      label,
      () => {
        app.equipmentTab = tab;
        app.craftWorkshopFilter = null;
        app.inventorySelected = -1;
      },
      app.equipmentTab === tab,
    ),
  );
  if (app.equipmentTab === 'craft') {
    const items = itemCatalog.filter(
        (item) =>
          item.workshop !== null &&
          (app.craftWorkshopFilter === null || item.workshop === app.craftWorkshopFilter),
      ),
      rows = Math.max(2, Math.floor((panel.h - 66) / 35)),
      pages = Math.ceil(items.length / rows);
    app.craftPage = Math.max(0, Math.min(pages - 1, app.craftPage));
    items.slice(app.craftPage * rows, (app.craftPage + 1) * rows).forEach((item, index) => {
      const workshop = app.town
        .buildings()
        .filter(
          (b) =>
            b.kind === item.workshop &&
            b.built() &&
            b.faction === p.faction &&
            app.town.settlementOf(b) === app.town.settlementOf(p),
        )
        .sort((a, b) => distance(p.position, a.center) - distance(p.position, b.center))[0];
      const reason = app.town.craftReason(p.id, workshop?.id ?? -1, item.id),
        r = new Rect(panel.x, top + index * 35, panel.w, 31);
      const state = button(
        c,
        `craft-item-${item.id}`,
        r,
        '',
        () => {
          if (workshop && app.town.orderCraft(p.id, workshop.id, item.id))
            app.status = `Crafting ${item.name}`;
        },
        ButtonStyle.Quiet,
        enabled && !reason,
      );
      itemIcon(c, new Rect(r.x, r.y, 31, 31), item);
      c.text(
        new Rect(r.x + 36, r.y, r.w * 0.45 - 36, 31),
        c.elideText(item.name, r.w * 0.45 - 36, 11, true),
        reason ? t.muted : t.text,
        11,
        true,
      );
      c.text(
        new Rect(r.x + r.w * 0.45, r.y, r.w * 0.55 - 9, 31),
        c.elideText(`Lv ${item.minimumLevel} · ${describe(item.cost)}`, r.w * 0.55 - 9, 10),
        t.accent,
        10,
        false,
        Align.End,
      );
      if (state.hovered || r.contains(app.mouse.x, app.mouse.y))
        c.text(
          new Rect(panel.x, panel.y + panel.h - 24, panel.w, 22),
          c.elideText(reason || item.description, panel.w, 10),
          t.muted,
          10,
        );
    });
    const y = panel.y + panel.h - 28;
    actionButton(
      c,
      'craft-prev',
      new Rect(panel.x + panel.w - 92, y, 28, 26),
      'back',
      'Previous recipes',
      () => --app.craftPage,
      false,
      app.craftPage > 0,
    );
    c.text(
      new Rect(panel.x + panel.w - 62, y, 28, 26),
      `${app.craftPage + 1}/${pages}`,
      t.muted,
      10,
      false,
      Align.Center,
    );
    actionButton(
      c,
      'craft-next',
      new Rect(panel.x + panel.w - 30, y, 28, 26),
      'next',
      'Next recipes',
      () => ++app.craftPage,
      false,
      app.craftPage < pages - 1,
    );
    return;
  }
  const cell = Math.max(16, Math.min(45, Math.floor((panel.w - 18) / 7), Math.floor((panel.h - 85) / 4))),
    bagW = cell * 4,
    gearX = panel.x + bagW + 14;
  const slots = inventorySlots(p);
  slots.forEach((slot, index) => {
    const r = new Rect(panel.x + (index % 4) * cell, top + Math.floor(index / 4) * cell, cell - 3, cell - 3),
      selected = app.inventorySelected === slot.slot;
    const state = button(
      c,
      `inventory-slot-${slot.slot}`,
      r,
      '',
      () => {
        if (
          app.inventorySelected >= 0 &&
          app.inventorySelected !== slot.slot &&
          !slot.item &&
          app.town.transferInventory(p.id, app.inventorySelected, slot.slot)
        )
          app.inventorySelected = -1;
        else app.inventorySelected = app.inventorySelected === slot.slot ? -1 : slot.slot;
      },
      selected ? ButtonStyle.Primary : ButtonStyle.Default,
      true,
    );
    itemIcon(c, r, slot.item, false, selected);
    if (slot.quantity)
      c.text(
        new Rect(r.x + 2, r.y + r.h - 16, r.w - 4, 15),
        String(slot.quantity),
        selected ? t.accentText : t.text,
        10,
        true,
        Align.End,
      );
    if (slot.equipped.length) c.rect(new Rect(r.x + 3, r.y + 3, 4, 4), t.success, 2);
    if (slot.cargo) c.text(new Rect(r.x + 2, r.y + 1, r.w - 4, 11), '↧', t.muted, 9);
    if (state.hovered)
      c.text(
        new Rect(panel.x, panel.y + panel.h - 22, panel.w, 20),
        slot.item
          ? `${slot.item.name} · ${slot.quantity}${slot.equipped.length ? ' · equipped' : ''}`
          : 'Empty inventory slot',
        t.muted,
        10,
      );
  });
  equipmentSlots.forEach((slot, index) => {
    const item = equippedItem(p, slot),
      r = new Rect(gearX + (index % 3) * cell, top + Math.floor(index / 3) * cell, cell - 3, cell - 3);
    const state = button(
      c,
      `equipment-slot-${slot}`,
      r,
      '',
      () => {
        if (app.inventorySelected > 0) {
          if (!app.town.equipItem(p.id, app.inventorySelected, slot))
            app.status = 'This item does not fit that slot or requires a higher level';
        } else app.town.unequipItem(p.id, slot);
      },
      item ? ButtonStyle.Primary : ButtonStyle.Default,
      enabled,
    );
    const placeholders = {
      weapon: 'sword',
      tool1: 'hammer',
      tool2: 'axe',
      head: 'helmet',
      body: 'leather-armor',
      feet: 'boots',
      hands: 'gloves',
      offhand: 'shield',
      accessory: 'cloak',
    };
    itemIcon(c, r, item ?? itemCatalog.find((i) => i.id === placeholders[slot]) ?? null, !item, !!item);
    if (state.hovered)
      c.text(
        new Rect(panel.x, panel.y + panel.h - 22, panel.w, 20),
        `${slot}: ${item?.name ?? 'empty'} · ${app.inventorySelected > 0 ? 'equip selected item' : 'click to unequip'}`,
        t.muted,
        10,
      );
  });
  const selected = slots.find((s) => s.slot === app.inventorySelected),
    y = top + cell * 3 + 4;
  actionButton(
    c,
    'inventory-equip',
    new Rect(gearX, y, 36, 28),
    'gear',
    'Equip selected item',
    () => {
      if (app.inventorySelected > 0 && !app.town.equipItem(p.id, app.inventorySelected))
        app.status = 'Select suitable gear and meet its level requirement';
    },
    false,
    enabled && !!selected?.item?.slots.length,
  );
  actionButton(
    c,
    'inventory-deposit',
    new Rect(gearX + 40, y, 36, 28),
    'bag',
    'Deposit selected resources',
    () => {
      if (!app.town.depositInventory(p.id, app.inventorySelected))
        app.status = app.town.inventoryTransferReason(p.id) || 'Storage cannot accept these resources';
    },
    false,
    enabled && selected?.item?.category === 'resource',
  );
  const resources = itemCatalog.filter((item) => item.category === 'resource');
  resources.slice(0, 4).forEach((item, index) => {
    const r = new Rect(gearX + index * cell * 0.7, top + cell * 4 + 5, cell * 0.65, 25);
    const state = button(
      c,
      `inventory-withdraw-${item.id}`,
      r,
      '',
      () => {
        if (!app.town.withdrawInventory(p.id, item.product, 1))
          app.status =
            app.town.inventoryTransferReason(p.id) || `No ${item.name.toLowerCase()} or inventory space`;
      },
      ButtonStyle.Quiet,
      enabled,
    );
    itemIcon(c, r, item);
    if (state.hovered)
      c.text(
        new Rect(panel.x, panel.y + panel.h - 22, panel.w, 20),
        `Take 1 ${item.name.toLowerCase()} from settlement storage`,
        t.muted,
        10,
      );
  });
  const detailX = gearX + cell * 3 + 16,
    detailW = panel.x + panel.w - detailX;
  if (detailW >= 150) {
    const box = new Rect(detailX, top, detailW, Math.min(panel.h - 58, 220));
    c.rect(box, t.raised, 3, t.border);
    const text = (at: number, value: string, color = t.text, size = 11, bold = false) => {
      if (at + 21 > box.h) return;
      c.text(
        new Rect(box.x + 12, box.y + at, box.w - 24, 21),
        c.elideText(value, box.w - 24, size, bold),
        color,
        size,
        bold,
      );
    };
    if (selected?.item) {
      itemIcon(c, new Rect(box.x + 12, box.y + 10, 42, 42), selected.item);
      text(57, selected.item.name, t.accent, 14, true);
      text(
        82,
        `Level ${selected.item.minimumLevel} · ${selected.item.category}`,
        p.level < selected.item.minimumLevel ? t.danger : t.muted,
      );
      text(
        105,
        selected.item.attackBonus
          ? `Attack +${selected.item.attackBonus}`
          : selected.item.defense
            ? `Armor ${Math.round(selected.item.defense * 100)}%`
            : `Quantity ${selected.quantity} / ${selected.item.maximumStack}`,
      );
      text(130, selected.item.description, t.muted, 10);
      text(
        157,
        selected.equipped.length ? `Equipped: ${selected.equipped.join(', ')}` : 'In the backpack',
        t.success,
        10,
      );
    } else {
      text(12, 'Equipment', t.accent, 14, true);
      text(43, `Attack ${attackDamage(p).toFixed(1)} · Armor ${Math.round(armorProtection(p) * 100)}%`);
      text(69, `Main hand: ${equippedItem(p, 'weapon')?.name ?? 'Bare hands'}`, t.muted);
      text(
        95,
        `Tools: ${
          ['tool1', 'tool2']
            .map((slot) => equippedItem(p, slot as 'tool1' | 'tool2')?.name)
            .filter(Boolean)
            .join(', ') || 'none'
        }`,
        t.muted,
      );
      text(121, `Backpack ${slots.filter((slot) => !slot.cargo && slot.item).length} / 15`, t.muted);
      text(157, 'Select an item, then choose a gear slot.', t.muted, 10);
    }
  }
  if (p.craftItem)
    c.text(new Rect(panel.x + 106, panel.y, panel.w - 106, 28), `Crafting ${p.craftItem}`, t.accent, 11);
}
