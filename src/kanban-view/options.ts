import { BasesPropertyId } from "obsidian";

import {
  CARD_SORT_PROPERTY_OPTION_KEY,
  COLUMN_ORDER_OPTION_KEY,
} from "./constants";

export function getKanbanViewOptions() {
  return [
    {
      key: CARD_SORT_PROPERTY_OPTION_KEY,
      displayName: "Card order property",
      type: "property" as const,
      placeholder: "Optional fallback for drag reorder",
      filter: (propertyId: BasesPropertyId) =>
        !propertyId.startsWith("file.") && !propertyId.startsWith("formula."),
    },
    {
      key: COLUMN_ORDER_OPTION_KEY,
      displayName: "Column order",
      type: "text" as const,
      default: "",
      placeholder: "Managed by drag and drop",
      shouldHide: () => true,
    },
  ];
}
