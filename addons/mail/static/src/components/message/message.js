/** @odoo-module **/

import { useComponentToModel } from '@mail/component_hooks/use_component_to_model';
import { useUpdate } from '@mail/component_hooks/use_update';
import { useUpdateToModel } from '@mail/component_hooks/use_update_to_model';
import { registerMessagingComponent } from '@mail/utils/messaging_component';
import { isEventHandled, markEventHandled } from '@mail/utils/utils';

import { _lt } from 'web.core';
import Popover from "web.Popover";

const { Component, onWillUnmount, useRef } = owl;

const READ_MORE = _lt("Read More");
const READ_LESS = _lt("Read Less");

export class Message extends Component {

    /**
     * @override
     */
    setup() {
        super.setup();
        useComponentToModel({ fieldName: 'component', modelName: 'MessageView' });
        useUpdateToModel({ methodName: 'onComponentUpdate', modelName: 'MessageView' });
        useUpdate({ func: () => this._update() });
        /**
         * Value of the last rendered prettyBody. Useful to compare to new value
         * to decide if it has to be updated.
         */
        this._lastPrettyBody;
        /**
         * Reference to element containing the prettyBody. Useful to be able to
         * replace prettyBody with new value in JS (which is faster than t-raw).
         */
        this._prettyBodyRef = useRef('prettyBody');
        /**
         * Reference to the content of the message.
         */
        this._contentRef = useRef('content');
        /**
         * To get checkbox state.
         */
        this._checkboxRef = useRef('checkbox');
        /**
         * Id of setInterval used to auto-update time elapsed of message at
         * regular time.
         */
        this._intervalId = undefined;
        onWillUnmount(() => this._willUnmount());
        /**
         * States the index of the last "read more" that was inserted.
         * Useful to remember the state for each "read more" even if their DOM
         * is re-rendered.
         */
        this._lastReadMoreIndex = 0;
        /**
         * Determines whether each "read more" is opened or closed. The keys are
         * index, which is determined by their order of appearance in the DOM.
         * If body changes so that "read more" count is different, their default
         * value will be "wrong" at the next render but this is an acceptable
         * limitation. It's more important to save the state correctly in a
         * typical non-changing situation.
         */
        this._isReadMoreByIndex = new Map();
    }

    _willUnmount() {
        clearInterval(this._intervalId);
    }

    //--------------------------------------------------------------------------
    // Public
    //--------------------------------------------------------------------------

    /**
     * Whether the message is "active", ie: hovered or clicked, and should
     * display additional things (date in sidebar, message actions, etc.)
     *
     * @returns {boolean}
     */
    get isActive() {
        return Boolean(
            this.messageView &&
            (
                this.messageView.isHovered ||
                this.messageView.isClicked ||
                (
                    this.messageView.messageActionList &&
                    (
                        this.messageView.messageActionList.reactionPopoverView ||
                        this.messageView.messageActionList.deleteConfirmDialog
                    )
                )
            )
        );
    }

    /**
     * Tell whether the bottom of this message is visible or not.
     *
     * @param {Object} param0
     * @param {integer} [offset=0]
     * @returns {boolean}
     */
    isBottomVisible({ offset = 0 } = {}) {
        if (!this.root.el) {
            return false;
        }
        const elRect = this.root.el.getBoundingClientRect();
        if (!this.root.el.parentNode) {
            return false;
        }
        const parentRect = this.root.el.parentNode.getBoundingClientRect();
        // bottom with (double) 10px offset
        return (
            elRect.bottom < parentRect.bottom + offset &&
            parentRect.top < elRect.bottom + offset
        );
    }

    /**
     * Tell whether the message is partially visible on browser window or not.
     *
     * @returns {boolean}
     */
    isPartiallyVisible() {
        if (!this.root.el) {
            return false;
        }
        const elRect = this.root.el.getBoundingClientRect();
        if (!this.root.el.parentNode) {
            return false;
        }
        const parentRect = this.root.el.parentNode.getBoundingClientRect();
        // intersection with 5px offset
        return (
            elRect.top < parentRect.bottom + 5 &&
            parentRect.top < elRect.bottom + 5
        );
    }

    /**
     * @returns {MessageView}
     */
    get messageView() {
        return this.messaging && this.messaging.models['MessageView'].get(this.props.localId);
    }

    /**
     * Make this message viewable in its enclosing scroll environment (usually
     * message list).
     *
     * @param {Object} [param0={}]
     * @param {string} [param0.behavior='auto']
     * @param {string} [param0.block='end']
     * @returns {Promise}
     */
    async scrollIntoView({ behavior = 'auto', block = 'end' } = {}) {
        this.root.el.scrollIntoView({
            behavior,
            block,
            inline: 'nearest',
        });
        if (behavior === 'smooth') {
            return new Promise(resolve => setTimeout(resolve, 500));
        } else {
            return Promise.resolve();
        }
    }

    //--------------------------------------------------------------------------
    // Private
    //--------------------------------------------------------------------------

    /**
     * Modifies the message to add the 'read more/read less' functionality
     * All element nodes with 'data-o-mail-quote' attribute are concerned.
     * All text nodes after a ``#stopSpelling`` element are concerned.
     * Those text nodes need to be wrapped in a span (toggle functionality).
     * All consecutive elements are joined in one 'read more/read less'.
     *
     * FIXME This method should be rewritten (task-2308951)
     *
     * @private
     * @param {jQuery} $element
     */
    _insertReadMoreLess($element) {
        const groups = [];
        let readMoreNodes;

        // nodeType 1: element_node
        // nodeType 3: text_node
        const $children = $element.contents()
            .filter((index, content) =>
                content.nodeType === 1 || (content.nodeType === 3 && content.nodeValue.trim())
            );

        for (const child of $children) {
            let $child = $(child);

            // Hide Text nodes if "stopSpelling"
            if (
                child.nodeType === 3 &&
                $child.prevAll('[id*="stopSpelling"]').length > 0
            ) {
                // Convert Text nodes to Element nodes
                $child = $('<span>', {
                    text: child.textContent,
                    'data-o-mail-quote': '1',
                });
                child.parentNode.replaceChild($child[0], child);
            }

            // Create array for each 'read more' with nodes to toggle
            if (
                $child.attr('data-o-mail-quote') ||
                (
                    $child.get(0).nodeName === 'BR' &&
                    $child.prev('[data-o-mail-quote="1"]').length > 0
                )
            ) {
                if (!readMoreNodes) {
                    readMoreNodes = [];
                    groups.push(readMoreNodes);
                }
                $child.hide();
                readMoreNodes.push($child);
            } else {
                readMoreNodes = undefined;
                this._insertReadMoreLess($child);
            }
        }

        for (const group of groups) {
            const index = this._lastReadMoreIndex++;
            // Insert link just before the first node
            const $readMoreLess = $('<a>', {
                class: 'o_Message_readMoreLess',
                href: '#',
                text: READ_MORE,
            }).insertBefore(group[0]);

            // Toggle All next nodes
            if (!this._isReadMoreByIndex.has(index)) {
                this._isReadMoreByIndex.set(index, true);
            }
            const updateFromState = () => {
                const isReadMore = this._isReadMoreByIndex.get(index);
                for (const $child of group) {
                    $child.hide();
                    $child.toggle(!isReadMore);
                }
                $readMoreLess.text(isReadMore ? READ_MORE : READ_LESS);
            };
            $readMoreLess.click(e => {
                e.preventDefault();
                this._isReadMoreByIndex.set(index, !this._isReadMoreByIndex.get(index));
                updateFromState();
            });
            updateFromState();
        }
    }

    /**
     * @private
     */
    _update() {
        if (!this.messageView) {
            return;
        }
        if (this._prettyBodyRef.el && this.messageView.message.prettyBody !== this._lastPrettyBody) {
            this._prettyBodyRef.el.innerHTML = this.messageView.message.prettyBody;
            this._lastPrettyBody = this.messageView.message.prettyBody;
        }
        if (!this._prettyBodyRef.el) {
            this._lastPrettyBody = undefined;
        }
        // Remove all readmore before if any before reinsert them with _insertReadMoreLess.
        // This is needed because _insertReadMoreLess is working with direct DOM mutations
        // which are not sync with Owl.
        if (this._contentRef.el) {
            for (const el of [...this._contentRef.el.querySelectorAll(':scope .o_Message_readMoreLess')]) {
                el.remove();
            }
            this._lastReadMoreIndex = 0;
            this._insertReadMoreLess($(this._contentRef.el));
            this.messaging.messagingBus.trigger('o-component-message-read-more-less-inserted', {
                message: this.messageView.message,
            });
        }
        this.messageView.message.refreshDateFromNow();
        clearInterval(this._intervalId);
        this._intervalId = setInterval(() => {
            if (this.messageView) {
                this.messageView.message.refreshDateFromNow();
            }
        }, 60 * 1000);
    }

    //--------------------------------------------------------------------------
    // Handlers
    //--------------------------------------------------------------------------

    /**
     * @private
     * @param {MouseEvent} ev
     */
    _onClick(ev) {
        if (ev.target.closest('.o_channel_redirect')) {
            this.messaging.openProfile({
                id: Number(ev.target.dataset.oeId),
                model: 'mail.channel',
            });
            // avoid following dummy href
            ev.preventDefault();
            return;
        }
        if (ev.target.tagName === 'A') {
            if (ev.target.dataset.oeId && ev.target.dataset.oeModel) {
                this.messaging.openProfile({
                    id: Number(ev.target.dataset.oeId),
                    model: ev.target.dataset.oeModel,
                });
                // avoid following dummy href
                ev.preventDefault();
            }
            return;
        }
        if (
            !isEventHandled(ev, 'Message.ClickAuthorAvatar') &&
            !isEventHandled(ev, 'Message.ClickAuthorName') &&
            !isEventHandled(ev, 'Message.ClickFailure') &&
            !isEventHandled(ev, 'MessageActionList.Click') &&
            !isEventHandled(ev, 'MessageReactionGroup.Click') &&
            !isEventHandled(ev, 'MessageInReplyToView.ClickMessageInReplyTo')
        ) {
            this.messageView.update({ isClicked: !this.messageView.isClicked });
        }
    }

    /**
     * @private
     * @param {MouseEvent} ev
     */
    _onClickAuthorAvatar(ev) {
        markEventHandled(ev, 'Message.ClickAuthorAvatar');
        if (!this.messageView.hasAuthorOpenChat) {
            return;
        }
        this.messageView.message.author.openChat();
    }

    /**
     * @private
     * @param {MouseEvent} ev
     */
    _onClickAuthorName(ev) {
        markEventHandled(ev, 'Message.ClickAuthorName');
        if (!this.messageView.message.author) {
            return;
        }
        this.messageView.message.author.openProfile();
    }

    /**
     * @private
     * @param {MouseEvent} ev
     */
    _onClickOriginThread(ev) {
        // avoid following dummy href
        ev.preventDefault();
        this.messageView.message.originThread.open();
    }
}

Object.assign(Message, {
    props: { localId: String },
    template: 'mail.Message',
    components: { Popover },
});

registerMessagingComponent(Message);
