/**
 * dsh-additions — browser half.
 *
 * Two surfaces, both on DSH's current client extension API (`ctx.slots`):
 *
 * 1. a "Move to workspace…" row in the Session context menu
 *    (`sidebar.workspaces.session.menu.item`) that opens a dialog;
 * 2. the dialog itself, mounted once in `shell.overlay`, listing every other
 *    registered workspace plus "Other folder…", warning about what does not
 *    travel, POSTing the host half's authenticated `/api/additions.move` route
 *    and reporting the outcome.
 *
 * The bundle is authored by hand in the loader's factory form. It requires only
 * platform modules (`react`, its jsx runtime, the UI primitives and the client
 * store) plus the injected Cordis services, so it needs no build step.
 *
 * All operator-visible copy comes from the `additions` locale namespace. `zh`
 * is the baseline key set and `en` the fallback, as everywhere in DSH; `it`
 * becomes selectable only when a language pack registers the language.
 */
window.__ModuleLoader__.load({
  id: 'dsh-additions',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')
    const jsxRuntime = require('react/jsx-runtime')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const clientStore = require('@deepseek-ai/dsh-client-store')

    /** Authenticated host route that performs one move. */
    const MOVE_ENDPOINT = '/api/additions.move'
    /** Slot id and locale namespace owned by this plugin. */
    const MENU_ID = 'additions.move'
    const DIALOG_ID = 'additions.move-dialog'
    const NAMESPACE = 'additions'
    /** Between Fork (300) and Archive (400) in ui-workspace's Session menu. */
    const MENU_ORDER = 350

    /**
     * UI copy for every language DSH ships plus Italian. Keys are stable and
     * complete in every locale; `zh` is the canonical baseline and values keep
     * the `{placeholder}` names exactly.
     */
    const BASE_DICTIONARIES = {
      zh: {
        action: '移动到工作区…',
        title: '移动此对话',
        warning:
          '副本会保留整段对话，但会获得新的会话 ID；AGENTS.md、技能、子代理和后台任务不会随行。',
        pick: '选择目标',
        otherFolder: '其他文件夹…',
        current: '当前',
        move: '移动',
        busy: '正在移动…',
        done: '已移动到 {title}',
        failed: '移动失败：{reason}',
        close: '关闭',
      },
      en: {
        action: 'Move to workspace…',
        title: 'Move this chat',
        warning:
          'The copy keeps the whole conversation but gets a new id; AGENTS.md, skills, subagents and background jobs do not travel.',
        pick: 'Choose a destination',
        otherFolder: 'Other folder…',
        current: 'current',
        move: 'Move',
        busy: 'Moving…',
        done: 'Moved to {title}',
        failed: 'Move failed: {reason}',
        close: 'Close',
      },
      ja: {
        action: 'ワークスペースへ移動…',
        title: 'このチャットを移動',
        warning:
          'コピーは会話全体を保ちますが、新しいセッション ID になります。AGENTS.md、スキル、サブエージェント、バックグラウンドのジョブは引き継がれません。',
        pick: '移動先を選択',
        otherFolder: '別のフォルダー…',
        current: '現在',
        move: '移動',
        busy: '移動中…',
        done: '{title} へ移動しました',
        failed: '移動に失敗しました: {reason}',
        close: '閉じる',
      },
      es: {
        action: 'Mover a otro espacio de trabajo…',
        title: 'Mover esta conversación',
        warning:
          'La copia conserva toda la conversación pero recibe un id nuevo; AGENTS.md, las skills, los subagentes y los trabajos en segundo plano no viajan.',
        pick: 'Elige el destino',
        otherFolder: 'Otra carpeta…',
        current: 'actual',
        move: 'Mover',
        busy: 'Moviendo…',
        done: 'Movida a {title}',
        failed: 'Error al mover: {reason}',
        close: 'Cerrar',
      },
      fr: {
        action: 'Déplacer vers un espace de travail…',
        title: 'Déplacer cette conversation',
        warning:
          "La copie conserve toute la conversation mais reçoit un nouvel identifiant ; AGENTS.md, les compétences, les sous-agents et les tâches d'arrière-plan ne suivent pas.",
        pick: 'Choisir la destination',
        otherFolder: 'Autre dossier…',
        current: 'actuel',
        move: 'Déplacer',
        busy: 'Déplacement…',
        done: 'Déplacée vers {title}',
        failed: 'Échec du déplacement : {reason}',
        close: 'Fermer',
      },
      de: {
        action: 'In einen anderen Arbeitsbereich verschieben…',
        title: 'Diesen Chat verschieben',
        warning:
          'Die Kopie behält die gesamte Unterhaltung, erhält aber eine neue ID; AGENTS.md, Skills, Subagenten und Hintergrundaufgaben wandern nicht mit.',
        pick: 'Ziel wählen',
        otherFolder: 'Anderer Ordner…',
        current: 'aktuell',
        move: 'Verschieben',
        busy: 'Wird verschoben…',
        done: 'Nach {title} verschoben',
        failed: 'Verschieben fehlgeschlagen: {reason}',
        close: 'Schließen',
      },
      ru: {
        action: 'Переместить в другое рабочее пространство…',
        title: 'Переместить этот чат',
        warning:
          'Копия сохраняет всю переписку, но получает новый идентификатор; AGENTS.md, навыки, субагенты и фоновые задачи не переносятся.',
        pick: 'Выберите назначение',
        otherFolder: 'Другая папка…',
        current: 'текущее',
        move: 'Переместить',
        busy: 'Перемещение…',
        done: 'Перемещено в {title}',
        failed: 'Не удалось переместить: {reason}',
        close: 'Закрыть',
      },
      pt: {
        action: 'Mover para outro workspace…',
        title: 'Mover esta conversa',
        warning:
          'A cópia mantém toda a conversa mas recebe um novo id; AGENTS.md, skills, subagentes e tarefas em segundo plano não viajam.',
        pick: 'Escolha o destino',
        otherFolder: 'Outra pasta…',
        current: 'atual',
        move: 'Mover',
        busy: 'Movendo…',
        done: 'Movida para {title}',
        failed: 'Falha ao mover: {reason}',
        close: 'Fechar',
      },
      it: {
        action: 'Sposta nel workspace…',
        title: 'Sposta questa chat',
        warning:
          'La copia conserva tutta la conversazione ma riceve un nuovo id; AGENTS.md, le skill, i subagenti e i job in background non viaggiano.',
        pick: 'Scegli la destinazione',
        otherFolder: "Un'altra cartella…",
        current: 'attuale',
        move: 'Sposta',
        busy: 'Spostamento in corso…',
        done: 'Spostata in {title}',
        failed: 'Spostamento non riuscito: {reason}',
        close: 'Chiudi',
      },
    }

    /** Attributes of the right-panel workspace tab. */
    const PANEL_ID = 'additions.workspace-panel'
    const PANEL_KIND = 'workspace-info'
    /** Authenticated route that answers one workspace's statistics. */
    const STATS_ROUTE = '/api/additions.workspace-stats'
    /** Authenticated routes for the notification cues and the host config. */
    const SOUND_ROUTE = '/api/additions.sound'
    const INFO_ROUTE = '/api/additions.info'
    /**
     * Settings namespace served by the host half: the loader entry id declared
     * in `cordis.patch.yml`, whose `Config` schema makes the notification-cue
     * fields editable in the Plugins page.
     */
    const SETTINGS_NAMESPACE = 'additions'
    /**
     * Keys of the `plugins.row.config` slot. The Plugins page keys a row's page
     * as `<bundle package name>#<row id>`; the same package can be installed
     * under its own name or under the historical dependency alias, so both
     * spellings are registered. Only the matching one is ever opened.
     */
    const SETTINGS_ROW_KEYS = ['dsh-additions#additions', 'dsh-chatshifter#additions']

    /**
     * Workspace-panel copy, merged into the base dictionaries so the namespace
     * stays complete against its Chinese baseline.
     */
    const PANEL_DICTIONARIES = {
      zh: {
        'type.label': '工作区',
        'guide.title': '工作区',
        'guide.description': '每个工作区的大小、文件与代码行数。',
        'panel.intro': '选择一个工作区查看其统计信息。',
        'panel.open': '详情',
        'panel.size': '大小',
        'panel.directories': '目录',
        'panel.files': '文件',
        'panel.codeLines': '代码行',
        'panel.docLines': '文档行',
        'panel.totalLines': '总行数',
        'panel.created': '创建于',
        'panel.loading': '正在读取…',
        'panel.error': '读取失败：{reason}',
        'panel.refresh': '重新读取',
        'panel.back': '返回',
        'panel.truncated': '扫描达到上限，数据不完整。',
      },
      en: {
        'type.label': 'Workspaces',
        'guide.title': 'Workspaces',
        'guide.description': 'Size, files and code lines of every workspace.',
        'panel.intro': 'Pick a workspace to see its statistics.',
        'panel.open': 'Details',
        'panel.size': 'Size',
        'panel.directories': 'Directories',
        'panel.files': 'Files',
        'panel.codeLines': 'Code lines',
        'panel.docLines': 'Doc lines',
        'panel.totalLines': 'Total lines',
        'panel.created': 'Created',
        'panel.loading': 'Reading…',
        'panel.error': 'Could not read: {reason}',
        'panel.refresh': 'Refresh',
        'panel.back': 'Back',
        'panel.truncated': 'The scan hit a limit: these numbers are partial.',
      },
      ja: {
        'type.label': 'ワークスペース',
        'guide.title': 'ワークスペース',
        'guide.description': '各ワークスペースのサイズ、ファイル数、コード行数。',
        'panel.intro': '統計を見るワークスペースを選択します。',
        'panel.open': '詳細',
        'panel.size': 'サイズ',
        'panel.directories': 'ディレクトリ',
        'panel.files': 'ファイル',
        'panel.codeLines': 'コード行',
        'panel.docLines': 'ドキュメント行',
        'panel.totalLines': '合計行数',
        'panel.created': '作成日',
        'panel.loading': '読み取り中…',
        'panel.error': '読み取りに失敗しました: {reason}',
        'panel.refresh': '再読み込み',
        'panel.back': '戻る',
        'panel.truncated': 'スキャンが上限に達しました。数値は一部のみです。',
      },
      es: {
        'type.label': 'Espacios de trabajo',
        'guide.title': 'Espacios de trabajo',
        'guide.description': 'Tamaño, archivos y líneas de código de cada espacio.',
        'panel.intro': 'Elige un espacio de trabajo para ver sus estadísticas.',
        'panel.open': 'Detalles',
        'panel.size': 'Tamaño',
        'panel.directories': 'Directorios',
        'panel.files': 'Archivos',
        'panel.codeLines': 'Líneas de código',
        'panel.docLines': 'Líneas de documentación',
        'panel.totalLines': 'Líneas totales',
        'panel.created': 'Creado',
        'panel.loading': 'Leyendo…',
        'panel.error': 'No se pudo leer: {reason}',
        'panel.refresh': 'Actualizar',
        'panel.back': 'Volver',
        'panel.truncated': 'La exploración alcanzó un límite: las cifras son parciales.',
      },
      fr: {
        'type.label': 'Espaces de travail',
        'guide.title': 'Espaces de travail',
        'guide.description': 'Taille, fichiers et lignes de code de chaque espace.',
        'panel.intro': 'Choisissez un espace de travail pour voir ses statistiques.',
        'panel.open': 'Détails',
        'panel.size': 'Taille',
        'panel.directories': 'Dossiers',
        'panel.files': 'Fichiers',
        'panel.codeLines': 'Lignes de code',
        'panel.docLines': 'Lignes de documentation',
        'panel.totalLines': 'Lignes au total',
        'panel.created': 'Créé le',
        'panel.loading': 'Lecture…',
        'panel.error': 'Lecture impossible : {reason}',
        'panel.refresh': 'Actualiser',
        'panel.back': 'Retour',
        'panel.truncated': "L'analyse a atteint une limite : les chiffres sont partiels.",
      },
      de: {
        'type.label': 'Arbeitsbereiche',
        'guide.title': 'Arbeitsbereiche',
        'guide.description': 'Größe, Dateien und Codezeilen jedes Arbeitsbereichs.',
        'panel.intro': 'Wählen Sie einen Arbeitsbereich für seine Statistik.',
        'panel.open': 'Details',
        'panel.size': 'Größe',
        'panel.directories': 'Verzeichnisse',
        'panel.files': 'Dateien',
        'panel.codeLines': 'Codezeilen',
        'panel.docLines': 'Doku-Zeilen',
        'panel.totalLines': 'Zeilen gesamt',
        'panel.created': 'Erstellt',
        'panel.loading': 'Wird gelesen…',
        'panel.error': 'Lesen fehlgeschlagen: {reason}',
        'panel.refresh': 'Aktualisieren',
        'panel.back': 'Zurück',
        'panel.truncated': 'Die Suche hat ein Limit erreicht: die Zahlen sind unvollständig.',
      },
      ru: {
        'type.label': 'Рабочие пространства',
        'guide.title': 'Рабочие пространства',
        'guide.description': 'Размер, файлы и строки кода каждого рабочего пространства.',
        'panel.intro': 'Выберите рабочее пространство, чтобы увидеть статистику.',
        'panel.open': 'Подробности',
        'panel.size': 'Размер',
        'panel.directories': 'Каталоги',
        'panel.files': 'Файлы',
        'panel.codeLines': 'Строки кода',
        'panel.docLines': 'Строки документации',
        'panel.totalLines': 'Всего строк',
        'panel.created': 'Создано',
        'panel.loading': 'Чтение…',
        'panel.error': 'Не удалось прочитать: {reason}',
        'panel.refresh': 'Обновить',
        'panel.back': 'Назад',
        'panel.truncated': 'Сканирование достигло лимита: цифры неполные.',
      },
      pt: {
        'type.label': 'Workspaces',
        'guide.title': 'Workspaces',
        'guide.description': 'Tamanho, arquivos e linhas de código de cada workspace.',
        'panel.intro': 'Escolha um workspace para ver as estatísticas.',
        'panel.open': 'Detalhes',
        'panel.size': 'Tamanho',
        'panel.directories': 'Pastas',
        'panel.files': 'Arquivos',
        'panel.codeLines': 'Linhas de código',
        'panel.docLines': 'Linhas de documentação',
        'panel.totalLines': 'Linhas totais',
        'panel.created': 'Criado',
        'panel.loading': 'Lendo…',
        'panel.error': 'Não foi possível ler: {reason}',
        'panel.refresh': 'Atualizar',
        'panel.back': 'Voltar',
        'panel.truncated': 'A leitura atingiu um limite: os números são parciais.',
      },
      it: {
        'type.label': 'Workspace',
        'guide.title': 'Workspace',
        'guide.description': 'Dimensione, file e righe di codice di ogni workspace.',
        'panel.intro': 'Scegli un workspace per vederne le statistiche.',
        'panel.open': 'Dettagli',
        'panel.size': 'Dimensione',
        'panel.directories': 'Directory',
        'panel.files': 'File',
        'panel.codeLines': 'Righe di codice',
        'panel.docLines': 'Righe di documentazione',
        'panel.totalLines': 'Righe totali',
        'panel.created': 'Creato',
        'panel.loading': 'Lettura…',
        'panel.error': 'Lettura non riuscita: {reason}',
        'panel.refresh': 'Aggiorna',
        'panel.back': 'Indietro',
        'panel.truncated': 'La scansione ha raggiunto un limite: i numeri sono parziali.',
      },
    }

    /**
     * Settings-page copy for the notification cues, merged into the base
     * dictionaries so every locale stays complete against the `zh` baseline.
     */
    const SETTINGS_DICTIONARIES = {
      zh: {
        'settings.title': '通知声音',
        'settings.description': '模型完成一轮或等待授权时播放提示音。',
        'settings.enabled': '启用通知声音',
        'settings.ding': '回合结束音',
        'settings.dingHint': '任意音频文件的绝对路径（wav、mp3、ogg、m4a、flac）。',
        'settings.approval': '授权请求音',
        'settings.approvalHint': '任意音频文件的绝对路径（wav、mp3、ogg、m4a、flac）。',
        'settings.defaultHint': '留空即使用内置声音。',
        'settings.save': '保存',
        'settings.saving': '正在保存…',
        'settings.saved': '已保存。',
        'settings.refused': '配置未接受这些值。',
        'settings.failed': '保存失败：{reason}',
        'settings.discard': '撤销',
        'settings.unavailable': '此主机未提供插件配置。',
        'settings.readOnly': '配置为只读。',
        'settings.summaryOn': '声音已开启',
        'settings.summaryOff': '声音已关闭',
      },
      en: {
        'settings.title': 'Notification sounds',
        'settings.description': 'Play a cue when the model finishes a turn or waits for a permission decision.',
        'settings.enabled': 'Enable notification sounds',
        'settings.ding': 'Turn finished',
        'settings.dingHint': 'Absolute path to any audio file (wav, mp3, ogg, m4a, flac).',
        'settings.approval': 'Permission request',
        'settings.approvalHint': 'Absolute path to any audio file (wav, mp3, ogg, m4a, flac).',
        'settings.defaultHint': 'Leave empty to use the packaged sound.',
        'settings.save': 'Save',
        'settings.saving': 'Saving…',
        'settings.saved': 'Saved.',
        'settings.refused': 'The configuration did not accept these values.',
        'settings.failed': 'Could not save: {reason}',
        'settings.discard': 'Discard',
        'settings.unavailable': 'This host does not expose the plugin configuration.',
        'settings.readOnly': 'The configuration is read-only.',
        'settings.summaryOn': 'Sounds on',
        'settings.summaryOff': 'Sounds off',
      },
      ja: {
        'settings.title': '通知音',
        'settings.description': 'モデルがターンを終えたとき、または権限の確認を待つときに音を鳴らします。',
        'settings.enabled': '通知音を有効にする',
        'settings.ding': 'ターン終了',
        'settings.dingHint': '音声ファイルの絶対パス（wav、mp3、ogg、m4a、flac）。',
        'settings.approval': '権限リクエスト',
        'settings.approvalHint': '音声ファイルの絶対パス（wav、mp3、ogg、m4a、flac）。',
        'settings.defaultHint': '空欄の場合は同梱の音を使用します。',
        'settings.save': '保存',
        'settings.saving': '保存中…',
        'settings.saved': '保存しました。',
        'settings.refused': '設定がこれらの値を受け付けませんでした。',
        'settings.failed': '保存できませんでした: {reason}',
        'settings.discard': '破棄',
        'settings.unavailable': 'このホストはプラグイン設定を公開していません。',
        'settings.readOnly': '設定は読み取り専用です。',
        'settings.summaryOn': 'サウンド有効',
        'settings.summaryOff': 'サウンド無効',
      },
      es: {
        'settings.title': 'Sonidos de notificación',
        'settings.description': 'Reproduce un aviso cuando el modelo termina un turno o espera una autorización.',
        'settings.enabled': 'Activar los sonidos de notificación',
        'settings.ding': 'Turno terminado',
        'settings.dingHint': 'Ruta absoluta de cualquier archivo de audio (wav, mp3, ogg, m4a, flac).',
        'settings.approval': 'Solicitud de permiso',
        'settings.approvalHint': 'Ruta absoluta de cualquier archivo de audio (wav, mp3, ogg, m4a, flac).',
        'settings.defaultHint': 'Déjalo vacío para usar el sonido incluido.',
        'settings.save': 'Guardar',
        'settings.saving': 'Guardando…',
        'settings.saved': 'Guardado.',
        'settings.refused': 'La configuración no aceptó estos valores.',
        'settings.failed': 'No se pudo guardar: {reason}',
        'settings.discard': 'Descartar',
        'settings.unavailable': 'Este host no expone la configuración del complemento.',
        'settings.readOnly': 'La configuración es de solo lectura.',
        'settings.summaryOn': 'Sonidos activados',
        'settings.summaryOff': 'Sonidos desactivados',
      },
      fr: {
        'settings.title': 'Sons de notification',
        'settings.description': 'Joue un signal lorsque le modèle termine un tour ou attend une autorisation.',
        'settings.enabled': 'Activer les sons de notification',
        'settings.ding': 'Tour terminé',
        'settings.dingHint': 'Chemin absolu vers un fichier audio (wav, mp3, ogg, m4a, flac).',
        'settings.approval': "Demande d'autorisation",
        'settings.approvalHint': 'Chemin absolu vers un fichier audio (wav, mp3, ogg, m4a, flac).',
        'settings.defaultHint': 'Laissez vide pour utiliser le son fourni.',
        'settings.save': 'Enregistrer',
        'settings.saving': 'Enregistrement…',
        'settings.saved': 'Enregistré.',
        'settings.refused': "La configuration n'a pas accepté ces valeurs.",
        'settings.failed': 'Enregistrement impossible : {reason}',
        'settings.discard': 'Annuler',
        'settings.unavailable': "Cet hôte n'expose pas la configuration du plugin.",
        'settings.readOnly': 'La configuration est en lecture seule.',
        'settings.summaryOn': 'Sons activés',
        'settings.summaryOff': 'Sons désactivés',
      },
      de: {
        'settings.title': 'Benachrichtigungstöne',
        'settings.description': 'Spielt einen Ton ab, wenn das Modell einen Zug beendet oder auf eine Freigabe wartet.',
        'settings.enabled': 'Benachrichtigungstöne aktivieren',
        'settings.ding': 'Zug beendet',
        'settings.dingHint': 'Absoluter Pfad zu einer Audiodatei (wav, mp3, ogg, m4a, flac).',
        'settings.approval': 'Berechtigungsanfrage',
        'settings.approvalHint': 'Absoluter Pfad zu einer Audiodatei (wav, mp3, ogg, m4a, flac).',
        'settings.defaultHint': 'Leer lassen, um den mitgelieferten Ton zu verwenden.',
        'settings.save': 'Speichern',
        'settings.saving': 'Wird gespeichert…',
        'settings.saved': 'Gespeichert.',
        'settings.refused': 'Die Konfiguration hat diese Werte nicht übernommen.',
        'settings.failed': 'Speichern fehlgeschlagen: {reason}',
        'settings.discard': 'Verwerfen',
        'settings.unavailable': 'Dieser Host stellt die Plugin-Konfiguration nicht bereit.',
        'settings.readOnly': 'Die Konfiguration ist schreibgeschützt.',
        'settings.summaryOn': 'Töne an',
        'settings.summaryOff': 'Töne aus',
      },
      ru: {
        'settings.title': 'Звуки уведомлений',
        'settings.description': 'Звук, когда модель завершает ход или ждёт подтверждения.',
        'settings.enabled': 'Включить звуки уведомлений',
        'settings.ding': 'Ход завершён',
        'settings.dingHint': 'Абсолютный путь к аудиофайлу (wav, mp3, ogg, m4a, flac).',
        'settings.approval': 'Запрос разрешения',
        'settings.approvalHint': 'Абсолютный путь к аудиофайлу (wav, mp3, ogg, m4a, flac).',
        'settings.defaultHint': 'Оставьте пустым, чтобы использовать встроенный звук.',
        'settings.save': 'Сохранить',
        'settings.saving': 'Сохранение…',
        'settings.saved': 'Сохранено.',
        'settings.refused': 'Конфигурация не приняла эти значения.',
        'settings.failed': 'Не удалось сохранить: {reason}',
        'settings.discard': 'Отменить',
        'settings.unavailable': 'Этот хост не предоставляет конфигурацию плагина.',
        'settings.readOnly': 'Конфигурация доступна только для чтения.',
        'settings.summaryOn': 'Звуки включены',
        'settings.summaryOff': 'Звуки выключены',
      },
      pt: {
        'settings.title': 'Sons de notificação',
        'settings.description': 'Reproduz um som quando o modelo termina um turno ou aguarda uma autorização.',
        'settings.enabled': 'Ativar os sons de notificação',
        'settings.ding': 'Turno concluído',
        'settings.dingHint': 'Caminho absoluto para qualquer arquivo de áudio (wav, mp3, ogg, m4a, flac).',
        'settings.approval': 'Pedido de permissão',
        'settings.approvalHint': 'Caminho absoluto para qualquer arquivo de áudio (wav, mp3, ogg, m4a, flac).',
        'settings.defaultHint': 'Deixe vazio para usar o som incluído.',
        'settings.save': 'Salvar',
        'settings.saving': 'Salvando…',
        'settings.saved': 'Salvo.',
        'settings.refused': 'A configuração não aceitou estes valores.',
        'settings.failed': 'Não foi possível salvar: {reason}',
        'settings.discard': 'Descartar',
        'settings.unavailable': 'Este host não expõe a configuração do plugin.',
        'settings.readOnly': 'A configuração é somente leitura.',
        'settings.summaryOn': 'Sons ativados',
        'settings.summaryOff': 'Sons desativados',
      },
      it: {
        'settings.title': 'Suoni di notifica',
        'settings.description': 'Riproduce un segnale quando il modello chiude un turno o attende un’autorizzazione.',
        'settings.enabled': 'Attiva i suoni di notifica',
        'settings.ding': 'Fine turno',
        'settings.dingHint': 'Percorso assoluto di un file audio (wav, mp3, ogg, m4a, flac).',
        'settings.approval': 'Richiesta di autorizzazione',
        'settings.approvalHint': 'Percorso assoluto di un file audio (wav, mp3, ogg, m4a, flac).',
        'settings.defaultHint': 'Lascia vuoto per usare il suono incluso.',
        'settings.save': 'Salva',
        'settings.saving': 'Salvataggio…',
        'settings.saved': 'Salvato.',
        'settings.refused': 'La configurazione non ha accettato questi valori.',
        'settings.failed': 'Salvataggio non riuscito: {reason}',
        'settings.discard': 'Annulla',
        'settings.unavailable': 'Questo host non espone la configurazione del plugin.',
        'settings.readOnly': 'La configurazione è in sola lettura.',
        'settings.summaryOn': 'Suoni attivi',
        'settings.summaryOff': 'Suoni disattivati',
      },
    }

    /** One complete dictionary per locale: base copy plus the panel keys. */
    const DICTIONARIES = Object.fromEntries(
      Object.entries(BASE_DICTIONARIES).map(([locale, dictionary]) => [
        locale,
        {
          ...dictionary,
          ...(PANEL_DICTIONARIES[locale] ?? {}),
          ...(SETTINGS_DICTIONARIES[locale] ?? {}),
        },
      ]),
    )

    /** Closed dialog state. */
    const INITIAL = Object.freeze({
      open: false,
      sessionId: null,
      title: '',
      phase: 'pick',
      workspaceTitle: null,
      error: null,
    })

    /**
     * @param error - a caught failure.
     * @returns a displayable message.
     */
    function messageOf(error) {
      return error instanceof Error ? error.message : String(error)
    }

    /**
     * Own the move dialog's state and its one host call.
     *
     * The fetcher, the post-move refresh and the store are injected so the flow
     * is unit-testable without a browser or a live host.
     *
     * @param options - `{ fetcher?, refresh?, store? }` seams.
     * @returns `{ store, open, close, moveTo }`.
     */
    function createMoveController(options = {}) {
      const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
      const refresh = options.refresh ?? (() => {})
      const store = options.store ?? clientStore.createSnapshotStore(INITIAL)

      const open = (sessionId, title) => {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return false
        store.set({ ...INITIAL, open: true, sessionId, title: typeof title === 'string' ? title : '' })
        return true
      }

      const close = () => {
        const current = store.getSnapshot()
        if (!current.open) return
        store.set({ ...current, open: false })
      }

      /**
       * Move the open chat to one destination.
       * @param destination - `{ workspaceId }` or `{ targetPath }`, plus a label.
       * @returns the settled phase (`done` or `error`).
       */
      const moveTo = async (destination) => {
        const current = store.getSnapshot()
        const sessionId = current.sessionId
        if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
        if (destination === undefined || destination === null) return undefined
        store.set({ ...current, phase: 'busy', error: null, workspaceTitle: null })
        const body =
          typeof destination.targetPath === 'string' && destination.targetPath.length > 0
            ? { sessionId, targetPath: destination.targetPath }
            : { sessionId, workspaceId: destination.workspaceId }
        try {
          const response = await fetcher(MOVE_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          const payload = await response.json().catch(() => null)
          if (response.ok !== true || payload?.ok !== true) {
            throw new Error(payload?.error?.message ?? `HTTP ${response.status}`)
          }
          await refresh()
          const latest = store.getSnapshot()
          store.set({
            ...latest,
            phase: 'done',
            workspaceTitle:
              typeof payload.workspaceTitle === 'string' && payload.workspaceTitle.length > 0
                ? payload.workspaceTitle
                : destination.label ?? body.workspaceId ?? body.targetPath,
          })
          return 'done'
        } catch (error) {
          const latest = store.getSnapshot()
          store.set({ ...latest, phase: 'error', error: messageOf(error) })
          return 'error'
        }
      }

      return { store, open, close, moveTo }
    }

    /**
     * The Session menu row that opens the dialog.
     * @param props - slot props, the menu-open hook, and the captured chat.
     * @returns the menu row.
     */
    function MoveMenuItemWithMenu(props) {
      const [, setMenuOpen] = props.useMenuOpenState()
      return jsxRuntime.jsx(MoveMenuRow, {
        ...props,
        closeMenu: () => {
          setMenuOpen(false)
        },
      })
    }

    /**
     * Session menu row without a menu-open hook.
     * @param props - slot props and the captured chat.
     * @returns the menu row.
     */
    function MoveMenuItem(props) {
      if (typeof props.useMenuOpenState === 'function') return jsxRuntime.jsx(MoveMenuItemWithMenu, props)
      return jsxRuntime.jsx(MoveMenuRow, { ...props, closeMenu: () => {} })
    }

    /**
     * The actual primitive row.
     *
     * `MenuItemButton` reports a chosen row through `onSelect`, not `onClick`
     * (ui-workspace's own rows use the same prop): a row wired to `onClick`
     * renders and looks right while silently ignoring every click.
     *
     * @param props - slot props plus `closeMenu`.
     * @returns the menu row.
     */
    function MoveMenuRow(props) {
      const { sessionId, displayTitle, t, open, closeMenu } = props
      return jsxRuntime.jsx(primitives.MenuItemButton, {
        onSelect: () => {
          closeMenu()
          if (typeof open === 'function') open(sessionId, displayTitle)
        },
        children: t('action'),
      })
    }

    /**
     * The dialog: destination picker, warning, busy/outcome states.
     * @param props - localized copy, the controller and the workspace hook.
     * @returns the mounted modal.
     */
    function MoveDialog(props) {
      const { t, useMoveState, useWorkspaces, moveTo, close, pickFolder } = props
      const state = useMoveState((value) => value)
      const workspaces = useWorkspaces((snapshot) => (Array.isArray(snapshot?.items) ? snapshot.items : []))
      const busy = state.phase === 'busy'

      const destinationRow = (workspace) =>
        jsxRuntime.jsxs(
          'div',
          {
            style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' },
            children: [
              jsxRuntime.jsx(primitives.Button, {
                variant: 'outline',
                disabled: busy,
                onClick: () => {
                  void moveTo({
                    workspaceId: workspace.workspaceId,
                    label: workspace.title || workspace.path,
                  })
                },
                children: workspace.title || workspace.path,
              }),
              jsxRuntime.jsx('span', { style: { opacity: 0.7 }, children: workspace.path }),
            ],
          },
        )

      const body = () => {
        if (state.phase === 'busy') {
          return jsxRuntime.jsx('p', { children: t('busy') })
        }
        if (state.phase === 'done') {
          return jsxRuntime.jsx('p', {
            children: t('done', { title: state.workspaceTitle ?? '' }),
          })
        }
        if (state.phase === 'error') {
          return jsxRuntime.jsx('p', {
            style: { color: 'var(--dsw-alias-state-error-primary)' },
            children: t('failed', { reason: state.error ?? '' }),
          })
        }
        return jsxRuntime.jsxs('div', {
          children: [
            jsxRuntime.jsx('p', { children: t('pick') }),
            ...workspaces.map(destinationRow),
            jsxRuntime.jsx(primitives.Button, {
              variant: 'outline',
              disabled: busy,
              onClick: () => {
                void pickFolder().then((destination) => {
                  if (destination !== null && destination !== undefined) void moveTo(destination)
                })
              },
              children: t('otherFolder'),
            }),
          ],
        })
      }

      return jsxRuntime.jsx(primitives.Modal, {
        open: state.open === true,
        onClose: close,
        title: `${t('title')}${state.title === '' ? '' : ` — ${state.title}`}`,
        description: t('warning'),
        closeLabel: t('close'),
        footer: jsxRuntime.jsx(primitives.Button, {
          variant: 'primary',
          onClick: close,
          children: t('close'),
        }),
        children: body(),
      })
    }

    /**
     * Format a byte count with binary units.
     * @param bytes - raw size in bytes.
     * @returns `"1.4 MB"`, `"820 KB"`, `"12 B"`, or an em dash.
     */
    function formatBytes(bytes) {
      const value = Number(bytes)
      if (!Number.isFinite(value) || value < 0) return '—'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let size = value
      let unit = 0
      while (size >= 1024 && unit < units.length - 1) {
        size /= 1024
        unit += 1
      }
      return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
    }

    /**
     * Format a count for display.
     * @param value - count.
     * @returns the localized number, or an em dash.
     */
    function formatCount(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      try {
        return new Intl.NumberFormat().format(number)
      } catch {
        return String(number)
      }
    }

    /**
     * Format a workspace creation date.
     * @param value - ISO timestamp from the workspace view.
     * @returns the localized date, or the raw value.
     */
    function formatCreated(value) {
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return String(value)
      try {
        return date.toLocaleDateString()
      } catch {
        return String(value)
      }
    }

    /**
     * Read one workspace's statistics from the authenticated host route.
     *
     * @param workspaceId - workspace to measure.
     * @param fetcher - HTTP carrier (tests inject one).
     * @returns the host payload.
     */
    async function loadWorkspaceStats(workspaceId, fetcher) {
      const call = fetcher ?? ((input, init) => fetch(input, init))
      const query = new URLSearchParams({ workspaceId }).toString()
      const response = await call(`${STATS_ROUTE}?${query}`, { method: 'GET' })
      const payload = await response.json().catch(() => null)
      if (response.ok !== true || payload?.ok !== true) {
        throw new Error(payload?.error?.message ?? `HTTP ${response.status}`)
      }
      return payload
    }

    /** Row layout shared by the panel's list and its detail rows. */
    const PANEL_ROW = {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '12px',
      padding: '4px 0',
    }

    /**
     * The tab definition handed to `ctx.sidebarRightTabs`.
     *
     * A type is reachable from the pane's add control only through its `guide`
     * entries: `+` opens the guide tab, whose body lists every registered
     * entry. A type without entries can only be opened by a plugin that calls
     * `openTab` itself (as `ui-schedule` does from a header action), which is
     * why the entry below is what makes the panel discoverable.
     *
     * `icon` is deliberately omitted: the guide falls back to its own glyph,
     * so the panel never depends on an artwork export being present.
     *
     * @param t - namespace-bound translate.
     * @returns the definition.
     */
    function panelDefinition(t) {
      return {
        id: PANEL_ID,
        kind: PANEL_KIND,
        priority: 'builtin',
        title: () => t('type.label'),
        guide: [
          {
            id: 'workspaces',
            order: 10,
            title: () => t('guide.title'),
            description: () => t('guide.description'),
          },
        ],
      }
    }

    /**
     * The panel chip title.
     * @param props - slot props.
     * @returns the chip text.
     */
    function WorkspacePanelTitle(props) {
      if (typeof props.useTabInfo === 'function') return jsxRuntime.jsx(WorkspacePanelTitleWithTab, props)
      return jsxRuntime.jsx('span', { children: props.t('type.label') })
    }

    /**
     * @param props - the tab-information hook.
     * @returns the tab's own title text.
     */
    function WorkspacePanelTitleWithTab({ useTabInfo }) {
      const { tab } = useTabInfo()
      return jsxRuntime.jsx('span', { children: tab?.title ?? '' })
    }

    /**
     * The right-panel body: workspace list, then one workspace's statistics.
     * @param props - localized copy, the workspace hook and the stats loader.
     * @returns the panel content.
     */
    function WorkspacePanel(props) {
      const { t, useWorkspaces, loadStats } = props
      const workspaces = useWorkspaces((snapshot) => (Array.isArray(snapshot?.items) ? snapshot.items : []))
      const [selectedId, setSelectedId] = react.useState(null)
      const [status, setStatus] = react.useState({ phase: 'idle', data: null, error: null })

      const selected = workspaces.find((workspace) => workspace.workspaceId === selectedId) ?? null

      const inspect = (workspace) => {
        setSelectedId(workspace.workspaceId)
        setStatus({ phase: 'loading', data: null, error: null })
        void loadStats(workspace.workspaceId).then(
          (data) => setStatus({ phase: 'ready', data, error: null }),
          (error) => setStatus({ phase: 'error', data: null, error: messageOf(error) }),
        )
      }

      if (selected === null) {
        return jsxRuntime.jsxs('div', {
          style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' },
          children: [
            jsxRuntime.jsx('p', { style: { opacity: 0.75, margin: 0 }, children: t('panel.intro') }),
            ...workspaces.map((workspace) =>
              jsxRuntime.jsxs(
                'div',
                {
                  style: {
                    ...PANEL_ROW,
                    alignItems: 'flex-start',
                    borderBottom: '1px solid var(--dsw-alias-border-subtle)',
                  },
                  children: [
                    jsxRuntime.jsxs('div', {
                      style: { minWidth: 0 },
                      children: [
                        jsxRuntime.jsx('div', {
                          style: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' },
                          children: workspace.title || workspace.path,
                        }),
                        jsxRuntime.jsx('div', {
                          style: { fontSize: '12px', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis' },
                          children: workspace.path,
                        }),
                        ...(typeof workspace.createdAt === 'string'
                          ? [
                              jsxRuntime.jsx('div', {
                                style: { fontSize: '12px', opacity: 0.7 },
                                children: `${t('panel.created')} ${formatCreated(workspace.createdAt)}`,
                              }),
                            ]
                          : []),
                      ],
                    }),
                    jsxRuntime.jsx(primitives.Button, {
                      size: 'sm',
                      variant: 'outline',
                      onClick: () => inspect(workspace),
                      children: t('panel.open'),
                    }),
                  ],
                },
                workspace.workspaceId,
              ),
            ),
          ],
        })
      }

      const data = status.phase === 'ready' ? status.data : null
      const rows =
        data === null
          ? []
          : [
              [t('panel.size'), formatBytes(data.sizeBytes)],
              [t('panel.directories'), formatCount(data.directories)],
              [t('panel.files'), formatCount(data.files)],
              [t('panel.codeLines'), formatCount(data.codeLines)],
              [t('panel.docLines'), formatCount(data.docLines)],
              [t('panel.totalLines'), formatCount(data.totalLines)],
            ]

      return jsxRuntime.jsxs('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' },
        children: [
          jsxRuntime.jsxs('div', {
            children: [
              jsxRuntime.jsx('div', { style: { fontWeight: 600 }, children: selected.title || selected.path }),
              jsxRuntime.jsx('div', { style: { fontSize: '12px', opacity: 0.7 }, children: selected.path }),
              typeof selected.createdAt === 'string' &&
                jsxRuntime.jsx('div', {
                  style: { fontSize: '12px', opacity: 0.7 },
                  children: `${t('panel.created')} ${formatCreated(selected.createdAt)}`,
                }),
            ],
          }),
          status.phase === 'loading' && jsxRuntime.jsx('p', { children: t('panel.loading') }),
          status.phase === 'error' &&
            jsxRuntime.jsx('p', {
              style: { color: 'var(--dsw-alias-state-error-primary)' },
              children: t('panel.error', { reason: status.error ?? '' }),
            }),
          ...rows.map(([label, value]) =>
            jsxRuntime.jsxs('div', { style: PANEL_ROW, children: [
              jsxRuntime.jsx('span', { style: { opacity: 0.8 }, children: label }),
              jsxRuntime.jsx('span', { children: value }),
            ] }, label),
          ),
          data !== null &&
            data.truncated === true &&
            jsxRuntime.jsx('p', { style: { fontSize: '12px', opacity: 0.75 }, children: t('panel.truncated') }),
          jsxRuntime.jsxs('div', {
            style: { display: 'flex', gap: '8px' },
            children: [
              jsxRuntime.jsx(primitives.Button, {
                size: 'sm',
                variant: 'outline',
                disabled: status.phase === 'loading',
                onClick: () => inspect(selected),
                children: t('panel.refresh'),
              }),
              jsxRuntime.jsx(primitives.Button, {
                size: 'sm',
                variant: 'outline',
                onClick: () => {
                  setSelectedId(null)
                  setStatus({ phase: 'idle', data: null, error: null })
                },
                children: t('panel.back'),
              }),
            ],
          }),
        ],
      })
    }

    /**
     * Compare two session-status snapshots and report the cues they imply.
     *
     * The status map comes from `uiSession.sessionStatus` (exposed to slots as
     * `useSessionStatus`) and carries, per Session, at least `running` and the
     * effective `pendingInteraction`.
     *
     * - `running: true → false` means the model finished its turn → `ding`;
     * - a `pendingInteraction` appearing with `kind: 'approval'` means a
     *   permission decision is waiting → `approval`.
     *
     * @param previous - earlier snapshot (a Map), or undefined on the first pass.
     * @param next - current snapshot.
     * @returns `[{ sessionId, signal }]`.
     */
    function diffSessionStatus(previous, next) {
      const changes = []
      // Duck-typed on purpose: `instanceof Map` fails when the snapshot comes
      // from another realm (tests, iframes), and the shape is all that matters.
      if (next === undefined || next === null || typeof next.forEach !== 'function') return changes
      const before = typeof previous?.get === 'function' ? (id) => previous.get(id) : () => undefined
      next.forEach((status, sessionId) => {
        const prior = before(sessionId)
        if (prior === undefined || status === undefined || status === null) return
        if (prior.running === true && status.running === false) {
          changes.push({ sessionId, signal: 'ding' })
        }
        const waiting = status.pendingInteraction
        if (
          (prior.pendingInteraction === undefined || prior.pendingInteraction === null) &&
          waiting !== undefined &&
          waiting !== null &&
          waiting.kind === 'approval'
        ) {
          changes.push({ sessionId, signal: 'approval' })
        }
      })
      return changes
    }

    /** Default playback gain when the host config says nothing. */
    const DEFAULT_VOLUME = 0.7

    /**
     * Create the Web Audio player used by the notification cues.
     *
     * The context is created lazily and resumed on the first pointer/key event,
     * because browsers start audio suspended until a user gesture. A sound that
     * cannot play (no audio, blocked context, missing bytes) is logged and
     * swallowed: a notification must never break the UI.
     *
     * A cue is identified by its kind AND its configured path: `configure()`
     * drops the decoded buffer of a cue whose path changed, and the fetch URL
     * carries the path as a cache-buster, so repointing a sound from the
     * settings page is audible at the next notification without a page reload.
     *
     * @param options - seams for tests: `fetcher`, `createAudioContext`, `log`,
     * `enabled`, `volume`, `ding`, `approval`.
     * @returns `{ play, unlock, configure, enabled, volume, variants }`.
     */
    function createSoundPlayer(options = {}) {
      const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
      const createContext =
        options.createAudioContext ??
        (() => {
          const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext
          if (typeof Ctor !== 'function') throw new Error('Web Audio is not available')
          return new Ctor()
        })
      const log = options.log ?? ((message) => console.warn(`[additions] ${message}`))
      const settings = {
        enabled: options.enabled !== false,
        volume: typeof options.volume === 'number' ? options.volume : DEFAULT_VOLUME,
        ding: typeof options.ding === 'string' ? options.ding : '',
        approval: typeof options.approval === 'string' ? options.approval : '',
      }
      /** Decoded buffers keyed by `kind|path`, so a repointed cue cannot replay stale audio. */
      const buffers = new Map()
      const loading = new Map()
      let context

      const variantOf = (kind) => (typeof settings[kind] === 'string' ? settings[kind] : '')
      const bufferKey = (kind) => `${kind}|${variantOf(kind)}`

      /**
       * Forget decoded and in-flight work for one cue, after its path changed.
       * @param kind - cue whose configuration moved.
       */
      const invalidate = (kind) => {
        const prefix = `${kind}|`
        for (const key of [...buffers.keys()]) if (key.startsWith(prefix)) buffers.delete(key)
        for (const key of [...loading.keys()]) if (key.startsWith(prefix)) loading.delete(key)
      }

      const ensureContext = () => {
        if (context !== undefined) return context
        try {
          context = createContext()
        } catch (error) {
          log(`audio unavailable: ${messageOf(error)}`)
          context = null
        }
        return context
      }

      const unlock = () => {
        const current = ensureContext()
        if (current !== null && current.state === 'suspended' && typeof current.resume === 'function') {
          void current.resume().catch(() => {})
        }
      }

      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        for (const event of ['pointerdown', 'keydown']) {
          window.addEventListener(event, unlock, { passive: true })
        }
      }

      const load = (kind) => {
        const key = bufferKey(kind)
        const running = loading.get(key)
        if (running !== undefined) return running
        const variant = variantOf(kind)
        const query = `${SOUND_ROUTE}?which=${encodeURIComponent(kind)}${
          variant === '' ? '' : `&v=${encodeURIComponent(variant)}`
        }`
        const promise = (async () => {
          const response = await fetcher(query)
          if (response.ok !== true) throw new Error(`HTTP ${response.status}`)
          const bytes = await response.arrayBuffer()
          const current = ensureContext()
          if (current === null || typeof current.decodeAudioData !== 'function') return undefined
          return await current.decodeAudioData(bytes)
        })().finally(() => {
          loading.delete(key)
        })
        loading.set(key, promise)
        return promise
      }

      const play = async (kind) => {
        if (!settings.enabled) return false
        try {
          const key = bufferKey(kind)
          if (!buffers.has(key)) {
            const decoded = await load(kind)
            if (decoded === undefined) return false
            buffers.set(key, decoded)
          }
          const current = ensureContext()
          if (current === null) return false
          if (current.state === 'suspended' && typeof current.resume === 'function') await current.resume()
          const source = current.createBufferSource()
          source.buffer = buffers.get(key)
          const gain = current.createGain()
          gain.gain.value = settings.volume
          source.connect(gain)
          gain.connect(current.destination)
          source.start()
          return true
        } catch (error) {
          log(`${kind} cue failed: ${messageOf(error)}`)
          return false
        }
      }

      return {
        play,
        unlock,
        configure(next) {
          if (next === undefined || next === null) return
          if (typeof next.enabled === 'boolean') settings.enabled = next.enabled
          if (typeof next.volume === 'number' && Number.isFinite(next.volume)) {
            settings.volume = Math.min(1, Math.max(0, next.volume))
          }
          for (const kind of ['ding', 'approval']) {
            const path = next[kind]
            if (typeof path !== 'string' || path === settings[kind]) continue
            settings[kind] = path
            invalidate(kind)
          }
        },
        get enabled() {
          return settings.enabled
        },
        get volume() {
          return settings.volume
        },
        get variants() {
          return { ding: settings.ding, approval: settings.approval }
        },
      }
    }

    /**
     * Invisible watcher that turns status transitions into sounds.
     *
     * @param props - the standard `useSessionStatus` seat and the injected player.
     * @returns null (it renders nothing).
     */
    function SoundWatcher(props) {
      if (typeof props.useSessionStatus !== 'function') return null
      return jsxRuntime.jsx(SoundWatcherInner, props)
    }

    /**
     * @param props - the session-status hook and the player.
     * @returns null.
     */
    function SoundWatcherInner({ useSessionStatus, player }) {
      const statuses = useSessionStatus((snapshot) => snapshot)
      const previous = react.useRef(statuses)
      react.useEffect(() => {
        const changes = diffSessionStatus(previous.current, statuses)
        previous.current = statuses
        for (const change of changes) void player.play(change.signal)
      }, [player, statuses])
      return null
    }

    /**
     * The plugin's configuration page: the notification-cue switch and the two
     * audio paths, over the `additions` settings namespace.
     *
     * The Plugins page renders this in the `plugins.row.config` seat of the
     * bundle's `additions` row. The checkbox writes immediately; the two paths
     * are staged and submitted together by Save, so a half-typed path never
     * replaces a working sound.
     *
     * @param props - the asked view (`page`/`summary`), localized copy, the
     * bound settings form hook, and the writer.
     * @returns the one-liner or the form.
     */
    function SoundSettingsPage(props) {
      const { view, t, useSoundForm, saveSounds } = props
      const snapshot = useSoundForm((value) => value)
      const sounds = snapshot?.value?.sounds ?? {}
      const enabled = sounds.enabled !== false
      const acceptedDing = typeof sounds.ding === 'string' ? sounds.ding : ''
      const acceptedApproval = typeof sounds.approval === 'string' ? sounds.approval : ''

      const [ding, setDing] = react.useState(acceptedDing)
      const [approval, setApproval] = react.useState(acceptedApproval)
      const [notice, setNotice] = react.useState(null)
      const [busy, setBusy] = react.useState(false)

      react.useEffect(() => {
        setDing(acceptedDing)
      }, [acceptedDing])
      react.useEffect(() => {
        setApproval(acceptedApproval)
      }, [acceptedApproval])

      if (view === 'summary') return t(enabled ? 'settings.summaryOn' : 'settings.summaryOff')

      const unavailable = snapshot?.status === 'unavailable'
      const loading = snapshot?.status === 'loading'
      const readOnly = snapshot?.writable === false
      const disabled = busy || unavailable || loading || readOnly
      const dirty = ding !== acceptedDing || approval !== acceptedApproval

      const write = async (ops) => {
        setBusy(true)
        try {
          const accepted = await saveSounds(ops)
          setNotice({ kind: accepted ? 'saved' : 'refused' })
        } catch (error) {
          setNotice({ kind: 'failed', reason: messageOf(error) })
        } finally {
          setBusy(false)
        }
      }

      const savePaths = () =>
        write([
          { op: 'set', path: ['sounds', 'ding'], value: ding.trim() },
          { op: 'set', path: ['sounds', 'approval'], value: approval.trim() },
        ])

      const toggle = (next) => write([{ op: 'set', path: ['sounds', 'enabled'], value: next }])

      const discard = () => {
        setDing(acceptedDing)
        setApproval(acceptedApproval)
        setNotice(null)
      }

      const hint = { color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', lineHeight: 1.4 }
      const field = { display: 'grid', gap: '4px' }
      const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }

      const noticeLine = () => {
        if (notice === null) return readOnly ? jsxRuntime.jsx('p', { style: hint, children: t('settings.readOnly') }) : null
        if (notice.kind === 'saved') return jsxRuntime.jsx('p', { style: hint, children: t('settings.saved') })
        if (notice.kind === 'refused') return jsxRuntime.jsx('p', { style: hint, children: t('settings.refused') })
        return jsxRuntime.jsx('p', {
          style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' },
          children: t('settings.failed', { reason: notice.reason ?? '' }),
        })
      }

      return jsxRuntime.jsxs('section', {
        style: { display: 'grid', gap: '14px' },
        'data-additions-settings': '',
        children: [
          jsxRuntime.jsxs('div', {
            style: { display: 'grid', gap: '4px' },
            children: [
              jsxRuntime.jsx('h4', { style: { margin: 0 }, children: t('settings.title') }),
              jsxRuntime.jsx('p', { style: { ...hint, margin: 0 }, children: t('settings.description') }),
            ],
          }),
          unavailable
            ? jsxRuntime.jsx('p', { style: hint, children: t('settings.unavailable') })
            : jsxRuntime.jsxs('label', {
                style: row,
                children: [
                  jsxRuntime.jsx('span', { children: t('settings.enabled') }),
                  jsxRuntime.jsx(primitives.Switch, {
                    checked: enabled,
                    label: t('settings.enabled'),
                    disabled,
                    onChange: (next) => {
                      void toggle(next)
                    },
                  }),
                ],
              }),
          jsxRuntime.jsxs('label', {
            style: field,
            children: [
              jsxRuntime.jsx('span', { children: t('settings.ding') }),
              jsxRuntime.jsx(primitives.Input, {
                type: 'text',
                value: ding,
                placeholder: 'C:\\suoni\\ding.wav',
                disabled,
                'aria-label': t('settings.ding'),
                onChange: (event) => {
                  setDing(event.target.value)
                },
              }),
              jsxRuntime.jsxs('span', { style: hint, children: [t('settings.dingHint'), ' ', t('settings.defaultHint')] }),
            ],
          }),
          jsxRuntime.jsxs('label', {
            style: field,
            children: [
              jsxRuntime.jsx('span', { children: t('settings.approval') }),
              jsxRuntime.jsx(primitives.Input, {
                type: 'text',
                value: approval,
                placeholder: 'C:\\suoni\\uh-oh.mp3',
                disabled,
                'aria-label': t('settings.approval'),
                onChange: (event) => {
                  setApproval(event.target.value)
                },
              }),
              jsxRuntime.jsxs('span', {
                style: hint,
                children: [t('settings.approvalHint'), ' ', t('settings.defaultHint')],
              }),
            ],
          }),
          jsxRuntime.jsxs('div', {
            style: { display: 'flex', alignItems: 'center', gap: '8px' },
            children: [
              jsxRuntime.jsx(primitives.Button, {
                variant: 'primary',
                disabled: disabled || !dirty,
                onClick: () => {
                  void savePaths()
                },
                children: busy ? t('settings.saving') : t('settings.save'),
              }),
              jsxRuntime.jsx(primitives.Button, {
                variant: 'outline',
                disabled: disabled || !dirty,
                onClick: discard,
                children: t('settings.discard'),
              }),
              noticeLine(),
            ],
          }),
        ],
      })
    }

    /**
     * Activate the browser plugin.
     * @param ctx - client context carrying slots, locale, workspace/session state.
     */
    function apply(ctx) {
      const controller = createMoveController({
        refresh: () => Promise.resolve(ctx.sessions?.refresh?.()).then(() => undefined),
      })

      const pickFolder = async () => {
        const picker = ctx.remote?.directoryPicker
        if (picker === undefined || typeof picker.pick !== 'function') return null
        const path = await picker.pick()
        if (typeof path !== 'string' || path.length === 0) return null
        return { targetPath: path, label: path }
      }

      ctx.effect(() => ctx.locale.register(NAMESPACE, DICTIONARIES), 'additions: locale dictionaries')

      const soundPlayer = createSoundPlayer()
      let soundForm

      // The settings page owns the notification-cue configuration: its accepted
      // values are live (volatile fields), so the player follows them without a
      // reload. Injection is optional so a composition without the settings
      // service keeps the rest of the plugin and falls back to /info below.
      ctx.inject(['configForms'], (scope) => {
        soundForm = scope.configForms.get(SETTINGS_NAMESPACE)
        const refreshSoundConfig = () => {
          const snapshot = soundForm.getSnapshot()
          if (snapshot?.status !== 'ready') return
          const sounds = snapshot.value?.sounds
          if (sounds !== undefined && sounds !== null) soundPlayer.configure(sounds)
        }
        scope.effect(() => soundForm.subscribe(refreshSoundConfig), 'additions: notification settings')
        refreshSoundConfig()

        // One page per bundle-name spelling: the Plugins page keys a row's
        // configuration as `<package name>#<row id>`, and only the matching
        // registration is ever rendered.
        const settingsFace = () => ({
          hooks: { soundForm },
          saveSounds: (ops) => soundForm.mutate(ops),
        })
        for (const key of SETTINGS_ROW_KEYS) {
          scope.effect(
            () =>
              scope.configForms.whileServed([SETTINGS_NAMESPACE], () =>
                scope.slots.inject('plugins.row.config', () =>
                  scope.slots.register(
                    { name: 'plugins.row.config', key, locale: NAMESPACE, inject: settingsFace },
                    SoundSettingsPage,
                  ),
                ),
              ),
            `additions: settings page ${key}`,
          )
        }
      })

      void fetch(INFO_ROUTE)
        .then((response) => (response.ok === true ? response.json() : null))
        .then((payload) => {
          if (payload?.sounds === undefined) return
          // While the namespace is served the form mirrors the same live config,
          // and it is the authority for the cue paths the page edits.
          if (soundForm !== undefined && soundForm.getSnapshot()?.status === 'ready') return
          soundPlayer.configure(payload.sounds)
        })
        .catch(() => {})

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          { name: 'shell.overlay', id: 'additions.sound-watcher', inject: () => ({ player: soundPlayer }) },
          SoundWatcher,
        ),
      )

      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register(
          {
            name: 'sidebar.workspaces.session.menu.item',
            id: MENU_ID,
            order: MENU_ORDER,
            locale: NAMESPACE,
            inject: () => ({ open: controller.open }),
          },
          MoveMenuItem,
        ),
      )

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: DIALOG_ID,
            locale: NAMESPACE,
            inject: () => ({
              hooks: {
                moveState: controller.store,
                workspaces: ctx.workspaces.list,
              },
              moveTo: controller.moveTo,
              close: controller.close,
              pickFolder,
            }),
          },
          MoveDialog,
        ),
      )

      const bind = ctx.locale.bind(NAMESPACE)
      ctx.inject(['sidebarRightTabs'], (scope) => {
        scope.effect(
          () => scope.sidebarRightTabs.register(panelDefinition(bind)),
          'additions: workspace panel type',
        )
        scope.slots.inject('sidebar.right.pane.tab', () =>
          scope.slots.register(
            {
              name: 'sidebar.right.pane.tab',
              key: PANEL_ID,
              locale: NAMESPACE,
              inject: () => ({
                hooks: { workspaces: ctx.workspaces.list },
                loadStats: (workspaceId) => loadWorkspaceStats(workspaceId),
              }),
            },
            WorkspacePanel,
          ),
        )
        scope.slots.inject('sidebar.right.pane.tab.title', () =>
          scope.slots.register(
            { name: 'sidebar.right.pane.tab.title', key: PANEL_ID, locale: NAMESPACE },
            WorkspacePanelTitle,
          ),
        )
      })
    }

    exports.name = 'dsh-additions'
    exports.inject = ['slots', 'locale', 'workspaces', 'sessions', 'remote']
    exports.apply = apply
    /** Dictionaries and seams exposed for the repository's tests. */
    exports.__locales = DICTIONARIES
    exports.__controller = createMoveController
    exports.__endpoints = { move: MOVE_ENDPOINT, stats: STATS_ROUTE }
    exports.__slots = {
      menu: 'sidebar.workspaces.session.menu.item',
      dialog: 'shell.overlay',
      panel: 'sidebar.right.pane.tab',
      panelTitle: 'sidebar.right.pane.tab.title',
    }
    exports.__stats = { load: loadWorkspaceStats, formatBytes, formatCount, formatCreated }
    exports.__panel = { id: PANEL_ID, kind: PANEL_KIND, definition: panelDefinition }
    exports.__components = { MoveMenuRow, MoveMenuItem, MoveDialog, WorkspacePanel, SoundSettingsPage }
    exports.__sounds = { diffSessionStatus, createSoundPlayer, route: SOUND_ROUTE }
    exports.__settings = {
      namespace: SETTINGS_NAMESPACE,
      rowKeys: SETTINGS_ROW_KEYS,
      slot: 'plugins.row.config',
      page: SoundSettingsPage,
    }
    void react
    return module.exports
  },
})
