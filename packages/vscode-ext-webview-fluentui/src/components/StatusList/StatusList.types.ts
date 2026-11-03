/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ComponentPropsWithoutRef, type ReactNode, type Ref } from 'react';

/**
 * A fixed vocabulary, deliberately. A custom icon slot would make the list mean whatever each
 * caller decided, which is the opposite of what a status list is for.
 *
 * `skipped` is a stage that did not run, because it does not apply or because an earlier stage
 * failed. The component does not say why; put the reason in `detail`.
 */
export type StatusListItemStatus = 'pending' | 'active' | 'done' | 'error' | 'warning' | 'skipped';

export interface StatusListProps extends ComponentPropsWithoutRef<'div'> {
    /** Accessible name of the list. */
    readonly ariaLabel: string;
    /**
     * The word appended to each row's label for assistive technology. Defaults to English; pass
     * localized words if the consumer ships translations.
     */
    readonly statusLabels?: Partial<Record<StatusListItemStatus, string>>;
    /** `StatusListItem` rows. */
    readonly children: ReactNode;
}

export interface StatusListItemProps extends ComponentPropsWithoutRef<'div'> {
    readonly label: ReactNode;
    readonly status: StatusListItemStatus;
    /**
     * One line under the label. Anything: text, a `Link`, a joined sentence. It is kept after the
     * row settles, so the list reads as a receipt rather than a transient log.
     */
    readonly detail?: ReactNode;
    /**
     * Hold the detail line's height before it has content, so the row does not grow, and shift
     * everything below it, when the detail arrives. Named after `TabList.reserveSelectedTabSpace`,
     * which solves the same problem in the same shape.
     */
    readonly reserveDetailSpace?: boolean;
    /**
     * Optional expandable details: a toggle button, right after the label by default or at the end of
     * the detail line (`disclosure.placement`), and a labelled region below the detail line.
     * Collapsed, the row keeps its height; expanded, the region pushes the following rows down. Leave
     * it out on a row with nothing more to say.
     */
    readonly disclosure?: StatusListItemDisclosure;
}

/**
 * An inline disclosure: a real `<button>` with `aria-expanded` and `aria-controls`, and a
 * `role="region"` named by that button. Expanding or collapsing never moves focus.
 */
export interface StatusListItemDisclosure {
    /** What the region shows when expanded. Unmounted after the collapse motion; the region stays mounted. */
    readonly content: ReactNode;
    /** The toggle's visible text, for example a localized "Details". The package ships no strings. */
    readonly toggleText: string;
    /**
     * The toggle's accessible name, which also names the region. Include `toggleText` and the row's
     * label, for example "Details for Server address (DNS)", so voice control and screen readers agree.
     */
    readonly toggleLabel: string;
    /** Optional accessible description of the toggle, for example the most important finding. */
    readonly toggleDescription?: string;
    /** Controlled expanded state. Leave undefined to let the row keep its own state. */
    readonly expanded?: boolean;
    /** Initial state when uncontrolled. Defaults to collapsed. */
    readonly defaultExpanded?: boolean;
    readonly onExpandedChange?: (expanded: boolean) => void;
    /** The toggle button, for a consumer that moves focus when the row loses its disclosure. */
    readonly toggleRef?: Ref<HTMLButtonElement>;
    /**
     * Where the toggle sits. `label` (the default): right after the label, on the label's line.
     * `detail`: inline at the end of the detail line, in the detail line's type size, so the label
     * line stays a plain heading. The detail line is rendered for the toggle even when it is empty.
     */
    readonly placement?: StatusListItemDisclosurePlacement;
}

export type StatusListItemDisclosurePlacement = 'label' | 'detail';

/**
 * Severity of a {@link StatusListDetailsMessageProps | details message}. Deliberately narrower than
 * {@link StatusListItemStatus}: a message explains a row, it is not a stage.
 */
export type StatusListDetailsMessageSeverity = 'error' | 'warning' | 'info';

/**
 * A titled group inside a disclosure's content, for example one host. `title` replaces the HTML
 * `title` attribute, which a details section has no use for.
 */
export interface StatusListDetailsSectionProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
    /**
     * A visual heading: the details' base size, semibold, primary foreground. Not an HTML heading, so
     * it never breaks the page's heading outline. Wrap a code-like title, such as a host name, in
     * `<code>`.
     */
    readonly title?: ReactNode;
    readonly children: ReactNode;
}

/** One term and value pair of a {@link StatusListDetailsFactsProps | facts list}. */
export interface StatusListDetailsFact {
    /** The label, in the secondary foreground. Unique within one list; it is also the React key. */
    readonly term: string;
    /**
     * Anything: text, a `<code>` fragment, a short `<ul>` of several values. Long values wrap anywhere,
     * so a host name never widens the panel.
     */
    readonly value: ReactNode;
    /** Render the whole value as code (`fontFamilyMonospace`), for a host name, an address or an option. */
    readonly mono?: boolean;
}

export interface StatusListDetailsFactsProps extends ComponentPropsWithoutRef<'dl'> {
    /**
     * The facts, in order. `false`, `null` and `undefined` entries are skipped, so a fact that only
     * sometimes applies can be written inline as `condition && { term, value }`. A list with no facts
     * renders nothing.
     */
    readonly items: readonly (StatusListDetailsFact | false | null | undefined)[];
}

/**
 * A finding, problem or hint inside a disclosure's content: a severity glyph, a semibold title, an
 * explanation and an optional next step. `title` replaces the HTML `title` attribute.
 */
export interface StatusListDetailsMessageProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
    readonly severity: StatusListDetailsMessageSeverity;
    /** One short line, semibold. */
    readonly title: ReactNode;
    /** The explanation, in regular weight under the title. */
    readonly children?: ReactNode;
    /**
     * What to do about it, on its own line after the explanation. Pass the whole localized line,
     * including any lead-in such as "Next:"; the package ships no strings.
     */
    readonly nextStep?: ReactNode;
    /**
     * The visually hidden word read before the title, including its punctuation, because the glyph
     * is `aria-hidden`. Defaults to English "Error:", "Warning:" or "Information:"; pass a localized
     * word if the consumer ships translations, or an empty string when the title already says it.
     */
    readonly severityLabel?: string;
}
