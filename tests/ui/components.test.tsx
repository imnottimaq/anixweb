import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, render, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import SelectDropdown from '../../src/components/SelectDropdown';
import RemoteImage from '../../src/components/RemoteImage';
import { Modal } from '../../src/modals/ModalTemplate';
import { SettingsContext } from '../../src/shared/contexts/settingsContext';
import { defaultAppSettings, type AppSettings } from '../../src/shared/types/settings';

describe('SelectDropdown Component (src/components/SelectDropdown.tsx)', () => {
    const testOptions = [
        { value: 'option1', label: 'Первый вариант' },
        { value: 'option2', label: 'Второй вариант' },
        { value: 'option3', label: 'Третий вариант' },
    ];

    it('renders with selected option and closed state by default', () => {
        render(
            <SelectDropdown
                value="option1"
                options={testOptions}
                onChange={vi.fn()}
                ariaLabel="Выбор опции"
            />
        );

        const triggerButton = screen.getByRole('button', { name: 'Первый вариант' });
        expect(triggerButton).toBeInTheDocument();
        expect(triggerButton).toHaveAttribute('aria-expanded', 'false');
        expect(triggerButton).toHaveAttribute('aria-haspopup', 'listbox');

        // Options listbox is closed
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('toggles open/close on trigger click and selects option on click', async () => {
        const handleChange = vi.fn();
        const user = userEvent.setup();

        render(
            <SelectDropdown
                value="option1"
                options={testOptions}
                onChange={handleChange}
                ariaLabel="Выбор опции"
            />
        );

        const triggerButton = screen.getByRole('button', { name: 'Первый вариант' });

        // Open dropdown
        await user.click(triggerButton);
        expect(triggerButton).toHaveAttribute('aria-expanded', 'true');

        const listbox = screen.getByRole('listbox', { name: 'Выбор опции' });
        expect(listbox).toBeInTheDocument();

        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(3);
        expect(options[0]).toHaveAttribute('aria-selected', 'true');
        expect(options[1]).toHaveAttribute('aria-selected', 'false');

        // Click second option
        await user.click(options[1]);
        expect(handleChange).toHaveBeenCalledWith('option2');

        // Dropdown closes after selection
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('dismisses dropdown when clicking outside', async () => {
        const user = userEvent.setup();

        render(
            <div>
                <div data-testid="outside-area">Вне селекта</div>
                <SelectDropdown
                    value="option1"
                    options={testOptions}
                    onChange={vi.fn()}
                    ariaLabel="Выбор опции"
                />
            </div>
        );

        const triggerButton = screen.getByRole('button', { name: 'Первый вариант' });
        await user.click(triggerButton);
        expect(screen.getByRole('listbox')).toBeInTheDocument();

        // Click outside on body
        fireEvent.mouseDown(screen.getByTestId('outside-area'));
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('closes on Escape key press and restores focus to trigger button', async () => {
        const user = userEvent.setup();

        render(
            <SelectDropdown
                value="option1"
                options={testOptions}
                onChange={vi.fn()}
                ariaLabel="Выбор опции"
            />
        );

        const triggerButton = screen.getByRole('button', { name: 'Первый вариант' });
        await user.click(triggerButton);
        expect(screen.getByRole('listbox')).toBeInTheDocument();

        // Press Escape
        await user.keyboard('{Escape}');

        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(triggerButton).toHaveFocus();
    });

    it('supports keyboard navigation with ArrowDown, ArrowUp, and Enter selection', async () => {
        const handleChange = vi.fn();
        const user = userEvent.setup();

        render(
            <SelectDropdown
                value="option1"
                options={testOptions}
                onChange={handleChange}
                ariaLabel="Выбор опции"
            />
        );

        const triggerButton = screen.getByRole('button', { name: 'Первый вариант' });
        triggerButton.focus();

        // Press ArrowDown to open dropdown
        await user.keyboard('{ArrowDown}');
        expect(screen.getByRole('listbox')).toBeInTheDocument();

        // First option is focused
        const options = screen.getAllByRole('option');
        expect(options[0]).toHaveFocus();

        // Navigate down to second option
        await user.keyboard('{ArrowDown}');
        expect(options[1]).toHaveFocus();

        // Navigate down to third option
        await user.keyboard('{ArrowDown}');
        expect(options[2]).toHaveFocus();

        // Wrap around to first option
        await user.keyboard('{ArrowDown}');
        expect(options[0]).toHaveFocus();

        // Navigate up backwards to third option
        await user.keyboard('{ArrowUp}');
        expect(options[2]).toHaveFocus();

        // Press Enter to select third option
        await user.keyboard('{Enter}');
        expect(handleChange).toHaveBeenCalledWith('option3');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(triggerButton).toHaveFocus();
    });

    it('supports Space key on focused option to select and close', async () => {
        const handleChange = vi.fn();
        const user = userEvent.setup();

        render(
            <SelectDropdown
                value="option1"
                options={testOptions}
                onChange={handleChange}
                ariaLabel="Выбор опции"
            />
        );

        const triggerButton = screen.getByRole('button', { name: 'Первый вариант' });
        await user.click(triggerButton);

        const options = screen.getAllByRole('option');
        options[1].focus();

        await user.keyboard(' ');
        expect(handleChange).toHaveBeenCalledWith('option2');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('opens dropdown and focuses option when pressing ArrowUp on trigger', async () => {
        const user = userEvent.setup();

        render(
            <SelectDropdown
                value="option2"
                options={testOptions}
                onChange={vi.fn()}
                ariaLabel="Выбор опции"
            />
        );

        const triggerButton = screen.getByRole('button', { name: 'Второй вариант' });
        triggerButton.focus();

        await user.keyboard('{ArrowUp}');
        expect(screen.getByRole('listbox')).toBeInTheDocument();

        const options = screen.getAllByRole('option');
        expect(options[1]).toHaveFocus();
    });
});

describe('RemoteImage Component (src/components/RemoteImage.tsx)', () => {
    function renderRemoteImageWithSettings(
        props: ComponentProps<typeof RemoteImage>,
        customSettings?: Partial<AppSettings>
    ) {
        const mergedSettings: AppSettings = {
            ...defaultAppSettings,
            content: {
                ...defaultAppSettings.content,
                ...customSettings?.content,
            },
        };

        return render(
            <SettingsContext.Provider value={{ settings: mergedSettings, setSettings: vi.fn() }}>
                <RemoteImage {...props} />
            </SettingsContext.Provider>
        );
    }

    it('returns null and renders nothing when src is empty or null', () => {
        const { container: c1 } = renderRemoteImageWithSettings({ src: null, alt: 'empty' });
        expect(c1).toBeEmptyDOMElement();

        const { container: c2 } = renderRemoteImageWithSettings({ src: '', alt: 'empty string' });
        expect(c2).toBeEmptyDOMElement();
    });

    it('normalizes protocol-relative // URLs with https:', () => {
        renderRemoteImageWithSettings({
            src: '//images.example.com/anime.jpg',
            alt: 'Protocol relative image',
        });

        const image = screen.getByRole('img', { name: 'Protocol relative image' });
        expect(image).toHaveAttribute('src', 'https://images.example.com/anime.jpg');
    });

    it('uses original URL when image proxy is disabled and falls back to mirror on load failure', () => {
        const onError = vi.fn();

        renderRemoteImageWithSettings({
            src: 'https://s.anixmirai.com/posters/999.jpg',
            alt: 'Mirror test image',
            onError,
        }, {
            content: { proxyImages: false } as AppSettings['content'],
        });

        const image = screen.getByRole('img', { name: 'Mirror test image' });
        // Initial src points to primary host
        expect(image).toHaveAttribute('src', 'https://s.anixmirai.com/posters/999.jpg');

        // Trigger first image load error
        fireEvent.error(image);

        // Should switch to mirror without calling external onError
        const mirrorImage = screen.getByRole('img', { name: 'Mirror test image' });
        expect(mirrorImage).toHaveAttribute('src', 'https://mirror-s.anixmirai.com/posters/999.jpg');
        expect(onError).not.toHaveBeenCalled();

        // Trigger second error on mirror
        fireEvent.error(mirrorImage);

        // Now external onError should be called
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('immediately calls onError on failure when image is not hosted on s.anixmirai.com', () => {
        const onError = vi.fn();

        renderRemoteImageWithSettings({
            src: 'https://external-cdn.com/art.png',
            alt: 'External CDN',
            onError,
        }, {
            content: { proxyImages: false } as AppSettings['content'],
        });

        const image = screen.getByRole('img', { name: 'External CDN' });
        expect(image).toHaveAttribute('src', 'https://external-cdn.com/art.png');

        // Trigger load failure
        fireEvent.error(image);

        // Since no mirror exists for external domain, external onError is called immediately
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('uses weserv proxy URL when proxyImages setting is enabled', () => {
        const onError = vi.fn();
        const rawUrl = 'https://s.anixmirai.com/covers/123.jpg';

        renderRemoteImageWithSettings({
            src: rawUrl,
            alt: 'Proxied image',
            onError,
        }, {
            content: { proxyImages: true } as AppSettings['content'],
        });

        const image = screen.getByRole('img', { name: 'Proxied image' });
        expect(image).toHaveAttribute(
            'src',
            `https://images.weserv.nl/?url=${encodeURIComponent(rawUrl)}`
        );

        // If proxy fails, error is forwarded immediately without attempting mirror
        fireEvent.error(image);
        expect(onError).toHaveBeenCalledTimes(1);
    });
});

describe('Modal Component (src/modals/ModalTemplate.tsx)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    function renderModal(props: ComponentProps<typeof Modal>) {
        return render(
            <SettingsContext.Provider value={{ settings: defaultAppSettings, setSettings: vi.fn() }}>
                <Modal {...props} />
            </SettingsContext.Provider>
        );
    }

    it('does not render anything when isOpen is false', () => {
        const { container } = renderModal({
            isOpen: false,
            onClose: vi.fn(),
            title: 'Скрытый диалог',
        });

        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders dialog elements with header, body, actions, and accessibility attributes', () => {
        const actionClick = vi.fn();

        renderModal({
            isOpen: true,
            onClose: vi.fn(),
            title: 'Заголовок модалки',
            text: 'Текст описания внутри модального окна',
            actions: [
                { label: 'Подтвердить', onClick: actionClick, variant: 'primary' },
                { label: 'Отмена', onClick: vi.fn(), variant: 'secondary' },
            ],
            children: <div data-testid="modal-children">Дочерний контент</div>,
        });

        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)).toHaveTextContent(screen.getByRole('heading').textContent!);

        expect(screen.getByRole('heading', { level: 2, name: 'Заголовок модалки' })).toBeInTheDocument();
        expect(screen.getByText('Текст описания внутри модального окна')).toBeInTheDocument();
        expect(screen.getByTestId('modal-children')).toBeInTheDocument();

        const confirmButton = screen.getByRole('button', { name: 'Подтвердить' });
        fireEvent.click(confirmButton);
        expect(actionClick).toHaveBeenCalledTimes(1);
    });

    it('dismisses modal on close button click after exit animation delay', () => {
        const onClose = vi.fn();

        renderModal({
            isOpen: true,
            onClose,
            title: 'Диалог с крестиком',
            showCloseButton: true,
        });

        const closeButton = screen.getByRole('button', { name: 'Закрыть' });
        fireEvent.click(closeButton);

        // Before animation timeout (180ms)
        expect(onClose).not.toHaveBeenCalled();

        // Advance timers by 180ms
        act(() => {
            vi.advanceTimersByTime(180);
        });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('dismisses on backdrop click, but ignores clicks inside modal section', () => {
        const onClose = vi.fn();

        renderModal({
            isOpen: true,
            onClose,
            title: 'Бекдроп тест',
            children: <button type="button">Кнопка внутри</button>,
        });

        const insideButton = screen.getByRole('button', { name: 'Кнопка внутри' });
        // Click inside modal section: should stop propagation
        fireEvent.mouseDown(insideButton);

        act(() => {
            vi.advanceTimersByTime(200);
        });
        expect(onClose).not.toHaveBeenCalled();

        // Click outside on presentation overlay
        const dialog = screen.getByRole('dialog');
        const overlay = dialog.parentElement!;
        fireEvent.mouseDown(overlay);

        act(() => {
            vi.advanceTimersByTime(180);
        });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('dismisses modal when Escape key is pressed', () => {
        const onClose = vi.fn();

        renderModal({
            isOpen: true,
            onClose,
            title: 'Escape тест',
        });

        fireEvent.keyDown(window, { key: 'Escape' });

        act(() => {
            vi.advanceTimersByTime(180);
        });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('supports render function children receiving handleClose callback', () => {
        const onClose = vi.fn();

        renderModal({
            isOpen: true,
            onClose,
            children: (close) => (
                <button type="button" onClick={close}>
                    Закрыть через children
                </button>
            ),
        });

        fireEvent.click(screen.getByRole('button', { name: 'Закрыть через children' }));

        act(() => {
            vi.advanceTimersByTime(180);
        });

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
