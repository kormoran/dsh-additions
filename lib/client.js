/**
 * dsh-chatshifter — browser half.
 *
 * Adds one structured Session context-menu action, "Move to workspace…", whose
 * submenu lists every other registered workspace plus "Other folder…". Choosing
 * a destination shows an explicit warning about what does not travel, then
 * calls the host half's authenticated `/api/chatshifter.move` route, refreshes
 * the Host-authoritative Session list and reports the outcome.
 *
 * All operator-visible copy comes from the `chatshifter` locale namespace.
 * The `zh` dictionary is the baseline: DSH types and ships every language
 * against the Chinese key set, requires `zh` and `en`, and falls back through
 * `en`. The `it` dictionary is registered here but the selectable Italian
 * language definition is owned by the Italian language pack (`dsh-locale-it`),
 * matching DSH's rule that a language pack registers the language itself.
 *
 * The bundle is authored by hand in the loader's factory form; it requires no
 * module, only injected Cordis services, so it needs no build step.
 */
window.__ModuleLoader__.load({
  id: 'dsh-chatshifter',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const MOVE_ENDPOINT = '/api/chatshifter.move'
    const INFO_ENDPOINT = '/api/chatshifter.info'
    /** Between Fork (300) and Copy session ID (450) in ui-workspace's menu. */
    const MENU_ORDER = 400
    const NAMESPACE = 'chatshifter'

    /**
     * UI copy for every language DSH ships (`zh`, `en`, `ja`, `es`, `fr`, `de`,
     * `ru`, `pt`) plus Italian. Keys are stable and complete in every locale;
     * `zh` is the canonical baseline. Values keep the `{placeholder}` names
     * exactly.
     */
    const DICTIONARIES = {
      zh: {
        action: '移动到工作区…',
        otherFolder: '其他文件夹…',
        pathPrompt: '目标文件夹的绝对路径：',
        currentSuffix: '（当前）',
        titleFallback: '此对话',
        'confirm.question': '将“{title}”移动到工作区“{destination}”？',
        'confirm.intro': '以下内容不会随对话一起移动：',
        'confirm.identity': '• 身份：会创建一个包含已复制历史记录的新对话；',
        'confirm.projectFiles': '• AGENTS.md、.dsh/skills 及其他项目文件：副本会读取新工作区的这些文件；',
        'confirm.subagents': '• 子会话、子代理和后台任务：仍留在原对话中；',
        'confirm.settings': '• 文件夹的本地设置和权限。',
        'confirm.archive': '原对话不会被删除：它仍保留在源工作区中，但会被隐藏（归档）。',
        'confirm.keep': '原对话仍然可见：移动操作会创建一份包含历史记录的副本。',
        'confirm.continue': '继续？',
        progress: '正在将“{title}”移动…',
        success: '“{title}”已移动到“{destination}”。新对话：{id}',
        'success.archived': '原对话已被隐藏（归档），未被删除。',
        'success.kept': '原对话仍保留在原处。',
        archiveFailed: '原对话未能归档：{reason}',
        failure: '移动失败：{reason}',
        invalidResponse: '服务器返回了无效响应（{status}）',
        refused: '请求被拒绝（{status}）',
        'error.invalid-body': '请求正文不是有效的 JSON。',
        'error.missing-session': '缺少要移动的对话。',
        'error.invalid-session-id': '对话 ID 无效。',
        'error.missing-target': '请选择目标工作区或文件夹。',
        'error.relative-path': '目标路径必须是绝对路径。',
        'error.subagent-session': '这是子代理会话，不能移动到工作区。请移动主对话。',
        'error.empty-session': '对话为空，没有可移动的内容。',
        'error.session-not-found': '未找到对话“{id}”。',
        'error.same-workspace': '该对话已在此工作区中。',
        'error.workspace-not-found': '目标工作区已不存在。',
        'error.invalid-path': '无法使用文件夹“{path}”：{reason}',
        'error.workspace-create-failed': '无法将“{path}”用作工作区：{reason}',
        'error.attach-failed': '副本已创建（{id}），但无法注册到“{workspace}”：{reason}',
        'error.internal': '移动时发生内部错误：{reason}',
        'error.unknown': '移动被拒绝：{reason}',
      },
      en: {
        action: 'Move to workspace…',
        otherFolder: 'Other folder…',
        pathPrompt: 'Absolute path of the destination folder:',
        currentSuffix: ' (current)',
        titleFallback: 'this chat',
        'confirm.question': 'Move "{title}" to workspace "{destination}"?',
        'confirm.intro': 'What does NOT move with the chat:',
        'confirm.identity': '• identity: a new chat is created with the history copied into it;',
        'confirm.projectFiles': '• AGENTS.md, .dsh/skills and other project files: the copy reads those of the new workspace;',
        'confirm.subagents': '• sub-sessions, subagents and background jobs: they stay with the original chat;',
        'confirm.settings': '• local folder settings and permissions.',
        'confirm.archive': 'The original is not deleted: it stays in the source workspace, hidden (archived).',
        'confirm.keep': 'The original stays visible: the move creates a copy with the history.',
        'confirm.continue': 'Continue?',
        progress: 'Moving "{title}"…',
        success: '"{title}" moved to "{destination}". New chat: {id}',
        'success.archived': ' The original was hidden (archived), not deleted.',
        'success.kept': ' The original stayed where it was.',
        archiveFailed: ' The original could not be archived: {reason}',
        failure: 'Move failed: {reason}',
        invalidResponse: 'Invalid response from the server ({status})',
        refused: 'Request refused ({status})',
        'error.invalid-body': 'The request body is not valid JSON.',
        'error.missing-session': 'Missing the chat to move.',
        'error.invalid-session-id': 'Invalid chat id.',
        'error.missing-target': 'Choose a destination workspace or folder.',
        'error.relative-path': 'The destination path must be absolute.',
        'error.subagent-session': 'This is a subagent session: it cannot be moved to a workspace. Move the main chat.',
        'error.empty-session': 'The chat is empty: there is nothing to move.',
        'error.session-not-found': 'Chat "{id}" was not found.',
        'error.same-workspace': 'The chat is already in this workspace.',
        'error.workspace-not-found': 'The destination workspace no longer exists.',
        'error.invalid-path': 'The folder "{path}" cannot be used: {reason}',
        'error.workspace-create-failed': 'Cannot use "{path}" as a workspace: {reason}',
        'error.attach-failed': 'The copy was created ({id}) but could not be registered in "{workspace}": {reason}',
        'error.internal': 'Internal error while moving: {reason}',
        'error.unknown': 'The move was refused: {reason}',
      },
      ja: {
        action: 'ワークスペースへ移動…',
        otherFolder: '別のフォルダー…',
        pathPrompt: '移動先フォルダーの絶対パス:',
        currentSuffix: '（現在）',
        titleFallback: 'このチャット',
        'confirm.question': '「{title}」をワークスペース「{destination}」へ移動しますか？',
        'confirm.intro': 'チャットに付いてこないもの:',
        'confirm.identity': '• 同一性: 履歴をコピーした新しいチャットが作成されます。',
        'confirm.projectFiles': '• AGENTS.md、.dsh/skills などのプロジェクトファイル: コピーは移動先ワークスペースのものを読み込みます。',
        'confirm.subagents': '• サブセッション、サブエージェント、バックグラウンドジョブ: 元のチャットに残ります。',
        'confirm.settings': '• フォルダーのローカル設定と権限。',
        'confirm.archive': '元のチャットは削除されません。元のワークスペースに残り、非表示（アーカイブ）になります。',
        'confirm.keep': '元のチャットは表示されたままです。移動は履歴を含むコピーを作成します。',
        'confirm.continue': '続行しますか？',
        progress: '「{title}」を移動しています…',
        success: '「{title}」を「{destination}」へ移動しました。新しいチャット: {id}。',
        'success.archived': '元のチャットは非表示（アーカイブ）になり、削除されていません。',
        'success.kept': '元のチャットは元の場所に残っています。',
        archiveFailed: '元のチャットをアーカイブできませんでした: {reason}',
        failure: '移動に失敗しました: {reason}',
        invalidResponse: 'サーバーからの応答が無効です（{status}）',
        refused: 'リクエストが拒否されました（{status}）',
        'error.invalid-body': 'リクエスト本文が有効な JSON ではありません。',
        'error.missing-session': '移動するチャットが指定されていません。',
        'error.invalid-session-id': 'チャット ID が無効です。',
        'error.missing-target': '移動先のワークスペースまたはフォルダーを指定してください。',
        'error.relative-path': '移動先のパスは絶対パスである必要があります。',
        'error.subagent-session': 'これはサブエージェントのセッションです。ワークスペースへは移動できません。メインのチャットを移動してください。',
        'error.empty-session': 'チャットが空です。移動する内容がありません。',
        'error.session-not-found': 'チャット「{id}」が見つかりません。',
        'error.same-workspace': 'このチャットはすでにこのワークスペースにあります。',
        'error.workspace-not-found': '移動先のワークスペースは存在しません。',
        'error.invalid-path': 'フォルダー「{path}」を使用できません: {reason}',
        'error.workspace-create-failed': '「{path}」をワークスペースとして使用できません: {reason}',
        'error.attach-failed': 'コピーは作成されました（{id}）が、ワークスペース「{workspace}」に登録できませんでした: {reason}',
        'error.internal': '移動中に内部エラーが発生しました: {reason}',
        'error.unknown': '移動が拒否されました: {reason}',
      },
      es: {
        action: 'Mover a un espacio de trabajo…',
        otherFolder: 'Otra carpeta…',
        pathPrompt: 'Ruta absoluta de la carpeta de destino:',
        currentSuffix: ' (actual)',
        titleFallback: 'este chat',
        'confirm.question': '¿Mover «{title}» al espacio de trabajo «{destination}»?',
        'confirm.intro': 'Lo que NO se mueve con el chat:',
        'confirm.identity': '• la identidad: se crea un chat nuevo con el historial copiado;',
        'confirm.projectFiles': '• AGENTS.md, .dsh/skills y otros archivos del proyecto: la copia lee los del nuevo espacio de trabajo;',
        'confirm.subagents': '• subsesiones, subagentes y trabajos en segundo plano: se quedan con el chat original;',
        'confirm.settings': '• los ajustes y permisos locales de la carpeta.',
        'confirm.archive': 'El original no se elimina: permanece en el espacio de trabajo de origen, oculto (archivado).',
        'confirm.keep': 'El original sigue visible: el movimiento crea una copia con el historial.',
        'confirm.continue': '¿Continuar?',
        progress: 'Moviendo «{title}»…',
        success: '«{title}» se ha movido a «{destination}». Nuevo chat: {id}',
        'success.archived': ' El original se ha ocultado (archivado), no eliminado.',
        'success.kept': ' El original se ha quedado donde estaba.',
        archiveFailed: ' No se pudo archivar el original: {reason}',
        failure: 'Error al mover: {reason}',
        invalidResponse: 'Respuesta no válida del servidor ({status})',
        refused: 'Solicitud rechazada ({status})',
        'error.invalid-body': 'El cuerpo de la solicitud no es JSON válido.',
        'error.missing-session': 'Falta el chat que se va a mover.',
        'error.invalid-session-id': 'Identificador de chat no válido.',
        'error.missing-target': 'Elige un espacio de trabajo o una carpeta de destino.',
        'error.relative-path': 'La ruta de destino debe ser absoluta.',
        'error.subagent-session': 'Esta es una subsesión de un subagente: no se puede mover a un espacio de trabajo. Mueve el chat principal.',
        'error.empty-session': 'El chat está vacío: no hay nada que mover.',
        'error.session-not-found': 'No se encontró el chat «{id}».',
        'error.same-workspace': 'El chat ya está en este espacio de trabajo.',
        'error.workspace-not-found': 'El espacio de trabajo de destino ya no existe.',
        'error.invalid-path': 'No se puede usar la carpeta «{path}»: {reason}',
        'error.workspace-create-failed': 'No se puede usar «{path}» como espacio de trabajo: {reason}',
        'error.attach-failed': 'Se creó la copia ({id}) pero no se pudo registrar en «{workspace}»: {reason}',
        'error.internal': 'Error interno al mover: {reason}',
        'error.unknown': 'Se rechazó el movimiento: {reason}',
      },
      fr: {
        action: 'Déplacer vers un espace de travail…',
        otherFolder: 'Autre dossier…',
        pathPrompt: 'Chemin absolu du dossier de destination :',
        currentSuffix: ' (actuel)',
        titleFallback: 'ce chat',
        'confirm.question': 'Déplacer « {title} » vers l’espace de travail « {destination} » ?',
        'confirm.intro': 'Ce qui ne suit PAS le chat :',
        'confirm.identity': '• l’identité : un nouveau chat est créé avec l’historique copié ;',
        'confirm.projectFiles': '• AGENTS.md, .dsh/skills et les autres fichiers du projet : la copie lit ceux du nouvel espace de travail ;',
        'confirm.subagents': '• les sous-sessions, sous-agents et tâches en arrière-plan : ils restent avec le chat d’origine ;',
        'confirm.settings': '• les réglages et autorisations locaux du dossier.',
        'confirm.archive': 'L’original n’est pas supprimé : il reste dans l’espace de travail d’origine, masqué (archivé).',
        'confirm.keep': 'L’original reste visible : le déplacement crée une copie avec l’historique.',
        'confirm.continue': 'Continuer ?',
        progress: 'Déplacement de « {title} »…',
        success: '« {title} » a été déplacé vers « {destination} ». Nouveau chat : {id}',
        'success.archived': ' L’original a été masqué (archivé), pas supprimé.',
        'success.kept': ' L’original est resté à sa place.',
        archiveFailed: ' L’original n’a pas pu être archivé : {reason}',
        failure: 'Échec du déplacement : {reason}',
        invalidResponse: 'Réponse invalide du serveur ({status})',
        refused: 'Requête refusée ({status})',
        'error.invalid-body': 'Le corps de la requête n’est pas un JSON valide.',
        'error.missing-session': 'Le chat à déplacer est manquant.',
        'error.invalid-session-id': 'Identifiant de chat invalide.',
        'error.missing-target': 'Choisissez un espace de travail ou un dossier de destination.',
        'error.relative-path': 'Le chemin de destination doit être absolu.',
        'error.subagent-session': 'Il s’agit d’une sous-session de sous-agent : elle ne peut pas être déplacée vers un espace de travail. Déplacez le chat principal.',
        'error.empty-session': 'Le chat est vide : il n’y a rien à déplacer.',
        'error.session-not-found': 'Chat « {id} » introuvable.',
        'error.same-workspace': 'Le chat est déjà dans cet espace de travail.',
        'error.workspace-not-found': 'L’espace de travail de destination n’existe plus.',
        'error.invalid-path': 'Impossible d’utiliser le dossier « {path} » : {reason}',
        'error.workspace-create-failed': 'Impossible d’utiliser « {path} » comme espace de travail : {reason}',
        'error.attach-failed': 'Copie créée ({id}) mais impossible de l’enregistrer dans « {workspace} » : {reason}',
        'error.internal': 'Erreur interne pendant le déplacement : {reason}',
        'error.unknown': 'Déplacement refusé : {reason}',
      },
      de: {
        action: 'In Arbeitsbereich verschieben…',
        otherFolder: 'Anderer Ordner…',
        pathPrompt: 'Absoluter Pfad des Zielordners:',
        currentSuffix: ' (aktuell)',
        titleFallback: 'dieser Chat',
        'confirm.question': '„{title}“ in den Arbeitsbereich „{destination}“ verschieben?',
        'confirm.intro': 'Was NICHT mit dem Chat umzieht:',
        'confirm.identity': '• die Identität: Es entsteht ein neuer Chat mit kopierter Historie;',
        'confirm.projectFiles': '• AGENTS.md, .dsh/skills und andere Projektdateien: die Kopie liest die des neuen Arbeitsbereichs;',
        'confirm.subagents': '• Untersitzungen, Subagenten und Hintergrundjobs: sie bleiben beim ursprünglichen Chat;',
        'confirm.settings': '• lokale Ordner-Einstellungen und -Berechtigungen.',
        'confirm.archive': 'Das Original wird nicht gelöscht: Es bleibt im Quellarbeitsbereich, verborgen (archiviert).',
        'confirm.keep': 'Das Original bleibt sichtbar: Das Verschieben erstellt eine Kopie mit der Historie.',
        'confirm.continue': 'Fortfahren?',
        progress: '„{title}“ wird verschoben…',
        success: '„{title}“ wurde nach „{destination}“ verschoben. Neuer Chat: {id}',
        'success.archived': ' Das Original wurde verborgen (archiviert), nicht gelöscht.',
        'success.kept': ' Das Original ist an seinem Platz geblieben.',
        archiveFailed: ' Das Original konnte nicht archiviert werden: {reason}',
        failure: 'Verschieben fehlgeschlagen: {reason}',
        invalidResponse: 'Ungültige Antwort vom Server ({status})',
        refused: 'Anfrage abgelehnt ({status})',
        'error.invalid-body': 'Der Anfragetext ist kein gültiges JSON.',
        'error.missing-session': 'Der zu verschiebende Chat fehlt.',
        'error.invalid-session-id': 'Ungültige Chat-ID.',
        'error.missing-target': 'Wähle einen Zielarbeitsbereich oder Ordner.',
        'error.relative-path': 'Der Zielpfad muss absolut sein.',
        'error.subagent-session': 'Dies ist eine Subagenten-Sitzung: Sie kann nicht in einen Arbeitsbereich verschoben werden. Verschiebe den Hauptchat.',
        'error.empty-session': 'Der Chat ist leer: Es gibt nichts zu verschieben.',
        'error.session-not-found': 'Chat „{id}“ wurde nicht gefunden.',
        'error.same-workspace': 'Der Chat ist bereits in diesem Arbeitsbereich.',
        'error.workspace-not-found': 'Der Zielarbeitsbereich existiert nicht mehr.',
        'error.invalid-path': 'Der Ordner „{path}“ kann nicht verwendet werden: {reason}',
        'error.workspace-create-failed': '„{path}“ kann nicht als Arbeitsbereich verwendet werden: {reason}',
        'error.attach-failed': 'Kopie erstellt ({id}), konnte aber nicht im Arbeitsbereich „{workspace}“ registriert werden: {reason}',
        'error.internal': 'Interner Fehler beim Verschieben: {reason}',
        'error.unknown': 'Verschieben abgelehnt: {reason}',
      },
      ru: {
        action: 'Переместить в рабочую область…',
        otherFolder: 'Другая папка…',
        pathPrompt: 'Абсолютный путь к папке назначения:',
        currentSuffix: ' (текущая)',
        titleFallback: 'этот чат',
        'confirm.question': 'Переместить «{title}» в рабочую область «{destination}»?',
        'confirm.intro': 'Что НЕ перемещается вместе с чатом:',
        'confirm.identity': '• идентичность: создаётся новый чат с копией истории;',
        'confirm.projectFiles': '• AGENTS.md, .dsh/skills и другие файлы проекта: копия читает их из новой рабочей области;',
        'confirm.subagents': '• подсессии, субагенты и фоновые задачи: остаются с исходным чатом;',
        'confirm.settings': '• локальные настройки и разрешения папки.',
        'confirm.archive': 'Оригинал не удаляется: он остаётся в исходной рабочей области, скрытый (в архиве).',
        'confirm.keep': 'Оригинал остаётся видимым: перемещение создаёт копию с историей.',
        'confirm.continue': 'Продолжить?',
        progress: 'Перемещение «{title}»…',
        success: '«{title}» перемещён в «{destination}». Новый чат: {id}',
        'success.archived': ' Оригинал скрыт (архивирован), но не удалён.',
        'success.kept': ' Оригинал остался на месте.',
        archiveFailed: ' Не удалось архивировать оригинал: {reason}',
        failure: 'Не удалось переместить: {reason}',
        invalidResponse: 'Недопустимый ответ сервера ({status})',
        refused: 'Запрос отклонён ({status})',
        'error.invalid-body': 'Тело запроса не является допустимым JSON.',
        'error.missing-session': 'Не указан чат для перемещения.',
        'error.invalid-session-id': 'Недопустимый идентификатор чата.',
        'error.missing-target': 'Укажите целевую рабочую область или папку.',
        'error.relative-path': 'Путь назначения должен быть абсолютным.',
        'error.subagent-session': 'Это подсессия субагента: её нельзя переместить в рабочую область. Переместите основной чат.',
        'error.empty-session': 'Чат пуст: перемещать нечего.',
        'error.session-not-found': 'Чат «{id}» не найден.',
        'error.same-workspace': 'Чат уже находится в этой рабочей области.',
        'error.workspace-not-found': 'Целевая рабочая область больше не существует.',
        'error.invalid-path': 'Не удалось использовать папку «{path}»: {reason}',
        'error.workspace-create-failed': 'Не удалось использовать «{path}» как рабочую область: {reason}',
        'error.attach-failed': 'Копия создана ({id}), но не зарегистрирована в рабочей области «{workspace}»: {reason}',
        'error.internal': 'Внутренняя ошибка при перемещении: {reason}',
        'error.unknown': 'Перемещение отклонено: {reason}',
      },
      pt: {
        action: 'Mover para um espaço de trabalho…',
        otherFolder: 'Outra pasta…',
        pathPrompt: 'Caminho absoluto da pasta de destino:',
        currentSuffix: ' (atual)',
        titleFallback: 'este chat',
        'confirm.question': 'Mover «{title}» para o espaço de trabalho «{destination}»?',
        'confirm.intro': 'O que NÃO vai junto com o chat:',
        'confirm.identity': '• a identidade: um novo chat é criado com o histórico copiado;',
        'confirm.projectFiles': '• AGENTS.md, .dsh/skills e outros arquivos do projeto: a cópia lê os do novo espaço de trabalho;',
        'confirm.subagents': '• subsessões, subagentes e tarefas em segundo plano: ficam com o chat original;',
        'confirm.settings': '• as configurações e permissões locais da pasta.',
        'confirm.archive': 'O original não é excluído: ele permanece no espaço de trabalho de origem, oculto (arquivado).',
        'confirm.keep': 'O original continua visível: a mudança cria uma cópia com o histórico.',
        'confirm.continue': 'Continuar?',
        progress: 'Movendo «{title}»…',
        success: '«{title}» foi movido para «{destination}». Novo chat: {id}',
        'success.archived': ' O original foi ocultado (arquivado), não excluído.',
        'success.kept': ' O original permaneceu onde estava.',
        archiveFailed: ' Não foi possível arquivar o original: {reason}',
        failure: 'Falha ao mover: {reason}',
        invalidResponse: 'Resposta inválida do servidor ({status})',
        refused: 'Solicitação recusada ({status})',
        'error.invalid-body': 'O corpo da solicitação não é JSON válido.',
        'error.missing-session': 'Falta o chat a ser movido.',
        'error.invalid-session-id': 'Identificador de chat inválido.',
        'error.missing-target': 'Escolha um espaço de trabalho ou uma pasta de destino.',
        'error.relative-path': 'O caminho de destino deve ser absoluto.',
        'error.subagent-session': 'Esta é uma subsessão de subagente: não pode ser movida para um espaço de trabalho. Mova o chat principal.',
        'error.empty-session': 'O chat está vazio: não há nada para mover.',
        'error.session-not-found': 'Chat «{id}» não encontrado.',
        'error.same-workspace': 'O chat já está neste espaço de trabalho.',
        'error.workspace-not-found': 'O espaço de trabalho de destino não existe mais.',
        'error.invalid-path': 'Não é possível usar a pasta «{path}»: {reason}',
        'error.workspace-create-failed': 'Não é possível usar «{path}» como espaço de trabalho: {reason}',
        'error.attach-failed': 'Cópia criada ({id}), mas não foi possível registrá-la em «{workspace}»: {reason}',
        'error.internal': 'Erro interno ao mover: {reason}',
        'error.unknown': 'A movimentação foi recusada: {reason}',
      },
      it: {
        action: 'Sposta nel workspace…',
        otherFolder: 'Altra cartella…',
        pathPrompt: 'Percorso assoluto della cartella di destinazione:',
        currentSuffix: ' (attuale)',
        titleFallback: 'questa chat',
        'confirm.question': 'Spostare «{title}» nel workspace «{destination}»?',
        'confirm.intro': 'Cosa NON viaggia con la chat:',
        'confirm.identity': '• l’identità: nasce una nuova chat con la storia copiata dentro;',
        'confirm.projectFiles': '• AGENTS.md, .dsh/skills e gli altri file di progetto: la copia legge quelli del nuovo workspace;',
        'confirm.subagents': '• sotto-sessioni, subagenti e job in background: restano con la chat originale;',
        'confirm.settings': '• impostazioni e permessi locali della cartella.',
        'confirm.archive': 'L’originale non viene cancellato: resta nel workspace di partenza, nascosto (archiviato).',
        'confirm.keep': 'L’originale resta visibile: lo spostamento crea una copia con la storia.',
        'confirm.continue': 'Continuare?',
        progress: 'Spostamento di «{title}» in corso…',
        success: '«{title}» spostata in «{destination}». Nuova chat: {id}',
        'success.archived': ' L’originale è stato nascosto (archiviato), non cancellato.',
        'success.kept': ' L’originale è rimasto dov’era.',
        archiveFailed: ' L’originale non è stato archiviato: {reason}',
        failure: 'Spostamento non riuscito: {reason}',
        invalidResponse: 'Risposta non valida dal server ({status})',
        refused: 'Richiesta rifiutata ({status})',
        'error.invalid-body': 'Il corpo della richiesta non è JSON valido.',
        'error.missing-session': 'Manca la chat da spostare.',
        'error.invalid-session-id': 'Identificatore della chat non valido.',
        'error.missing-target': 'Indica un workspace o una cartella di destinazione.',
        'error.relative-path': 'Il percorso di destinazione deve essere assoluto.',
        'error.subagent-session': 'Questa è una sotto-sessione di un subagente: non può essere spostata. Sposta la chat principale.',
        'error.empty-session': 'La chat è vuota: non c’è nulla da spostare.',
        'error.session-not-found': 'Chat «{id}» non trovata.',
        'error.same-workspace': 'La chat è già in questo workspace.',
        'error.workspace-not-found': 'Il workspace di destinazione non esiste più.',
        'error.invalid-path': 'Impossibile usare la cartella «{path}»: {reason}',
        'error.workspace-create-failed': 'Impossibile usare «{path}» come workspace: {reason}',
        'error.attach-failed': 'Copia creata ({id}) ma non registrata nel workspace «{workspace}»: {reason}',
        'error.internal': 'Errore interno durante lo spostamento: {reason}',
        'error.unknown': 'Spostamento rifiutato: {reason}',
      },
    }

    /** Host setting read once at activation: whether the original is hidden. */
    let archiveSource = true

    /**
     * @param value - session title captured by the menu row.
     * @param t - bound translate function.
     * @returns the title, or a localized neutral placeholder.
     */
    function titleOf(value, t) {
      return typeof value === 'string' && value.trim().length > 0 ? value.trim() : t('titleFallback')
    }

    /**
     * Read the host half's configuration once so the warning matches what the
     * move will actually do. Failures keep the documented default.
     */
    async function loadHostInfo() {
      try {
        const response = await fetch(INFO_ENDPOINT, {
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
        })
        if (!response.ok) return
        const body = await response.json()
        if (body?.ok === true && typeof body.archiveSource === 'boolean') archiveSource = body.archiveSource
      } catch {
        // The default (archive the original) stays in effect.
      }
    }

    /**
     * Build the confirmation text: the operation, the destination, and the
     * explicit list of what does not move with the chat.
     * @param t - bound translate function.
     * @param title - displayed source chat title.
     * @param destination - destination label (workspace title or path).
     * @returns the complete confirmation text.
     */
    function confirmation(t, title, destination) {
      return [
        t('confirm.question', { title, destination }),
        '',
        t('confirm.intro'),
        t('confirm.identity'),
        t('confirm.projectFiles'),
        t('confirm.subagents'),
        t('confirm.settings'),
        '',
        archiveSource ? t('confirm.archive') : t('confirm.keep'),
        '',
        t('confirm.continue'),
      ].join('\n')
    }

    /**
     * Call the host half.
     * @param payload - move input.
     * @param t - bound translate function.
     * @returns the parsed success body.
     * @throws when the host refuses or the carrier fails; the error carries
     *   the stable host code and details for the localized message.
     */
    async function postMove(payload, t) {
      const response = await fetch(MOVE_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin',
      })

      const raw = await response.text()
      let body
      try {
        body = raw.length > 0 ? JSON.parse(raw) : {}
      } catch {
        throw new Error(t('invalidResponse', { status: response.status }))
      }

      if (!response.ok || body?.ok !== true) {
        const refusal = body?.error ?? {}
        const error = new Error(refusal.message ?? t('refused', { status: response.status }))
        if (typeof refusal.code === 'string' && refusal.code.length > 0) error.code = refusal.code
        if (refusal.details !== undefined) error.details = refusal.details
        throw error
      }
      return body
    }

    /**
     * Ask for an absolute directory: the Host directory picker when composed,
     * otherwise a manual path prompt.
     * @param ctx - client context.
     * @param t - bound translate function.
     * @returns the chosen path, or null when the operator cancelled.
     */
    async function pickFolder(ctx, t) {
      const picker = ctx.remote?.directoryPicker
      if (picker !== undefined && typeof picker.pick === 'function') {
        try {
          const result = await picker.pick()
          if (result?.ok === true) return result.value ?? null
        } catch {
          // No native/browse picker composed: fall through to the manual prompt.
        }
      }
      const answer = window.prompt(t('pathPrompt'))
      return answer === null || answer.trim().length === 0 ? null : answer.trim()
    }

    /**
     * Render a refusal through the locale namespace, falling back to the
     * host's message for codes this bundle does not know.
     * @param t - bound translate function.
     * @param error - the caught failure.
     * @param destinationLabel - destination shown when the host omits a detail.
     * @returns the localized refusal reason.
     */
    function describeFailure(t, error, destinationLabel) {
      if (typeof error?.code !== 'string' || error.code.length === 0) {
        return typeof error?.message === 'string' ? error.message : String(error)
      }
      const details = error?.details ?? {}
      const params = {
        id: details.sessionId ?? '',
        workspace: details.workspace ?? destinationLabel,
        path: details.path ?? destinationLabel,
        reason: details.reason ?? (typeof error.message === 'string' ? error.message : String(error)),
      }
      const key = `error.${error.code}`
      const translated = t(key, params)
      return translated === key ? t('error.unknown', params) : translated
    }

    /**
     * Run one move after the operator confirmed it.
     * @param ctx - client context.
     * @param sessionId - source chat.
     * @param target - `{ workspaceId }` or `{ targetPath }`.
     * @param destinationLabel - destination name used in the copy.
     * @param title - source chat title.
     */
    async function runMove(ctx, sessionId, target, destinationLabel, title) {
      const t = ctx.locale.bind(NAMESPACE)
      if (!window.confirm(confirmation(t, title, destinationLabel))) return

      ctx.contextMenus.notify(t('progress', { title }), false)
      try {
        const result = await postMove({ sessionId, ...target }, t)
        await refreshSessionList(ctx)
        let message = t('success', {
          title,
          destination: result.workspaceTitle ?? destinationLabel,
          id: result.sessionId,
        })
        message += result.archived ? t('success.archived') : t('success.kept')
        if (result.archiveError !== undefined && result.archiveError !== null) {
          message += t('archiveFailed', { reason: result.archiveError })
        }
        ctx.contextMenus.notify(message, true)
      } catch (error) {
        ctx.contextMenus.notify(t('failure', { reason: describeFailure(t, error, destinationLabel) }), false)
      }
    }

    /**
     * Refresh the Host-authoritative Session list so the new row appears
     * without a page reload. A refresh failure is not a move failure: the next
     * navigation refreshes the list anyway.
     * @param ctx - client context.
     */
    async function refreshSessionList(ctx) {
      try {
        await ctx.sessions.refresh()
      } catch {
        // Deliberately ignored: the move itself already succeeded.
      }
    }

    /**
     * Build the Session menu contribution for one captured row.
     * @param ctx - client context.
     * @param target - captured Session target.
     * @returns menu actions.
     */
    function buildActions(ctx, target) {
      const sessionId = target?.sessionId
      if (typeof sessionId !== 'string' || sessionId.length === 0) return []

      const t = ctx.locale.bind(NAMESPACE)
      const title = titleOf(target.displayTitle, t)
      const snapshot = ctx.workspaces?.list?.getSnapshot?.()
      const workspaceList = Array.isArray(snapshot?.items) ? snapshot.items : []

      if (snapshot?.phase === 'pending' && workspaceList.length === 0) {
        return [{ id: 'chatshifter.move', label: t('action'), disabled: true }]
      }

      const owning = new Set(
        workspaceList
          .filter((workspace) => Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(sessionId))
          .map((workspace) => workspace.workspaceId),
      )

      const children = workspaceList.map((workspace) => {
        const current = owning.has(workspace.workspaceId)
        const label = `${workspace.title || workspace.path}${current ? t('currentSuffix') : ''}`
        return {
          id: `chatshifter.move.to.${workspace.workspaceId}`,
          label,
          disabled: current,
          run: current
            ? undefined
            : () =>
                runMove(
                  ctx,
                  sessionId,
                  { workspaceId: workspace.workspaceId },
                  workspace.title || workspace.path,
                  title,
                ),
        }
      })

      children.push({
        id: 'chatshifter.move.other',
        label: t('otherFolder'),
        separatorBefore: children.length > 0,
        run: async () => {
          const path = await pickFolder(ctx, t)
          if (path === null) return
          await runMove(ctx, sessionId, { targetPath: path }, path, title)
        },
      })

      return [{ id: 'chatshifter.move', label: t('action'), children }]
    }

    /**
     * Activate the browser plugin.
     * @param ctx - client context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NAMESPACE, DICTIONARIES), 'chatshifter: locale dictionaries')
      void loadHostInfo()
      ctx.effect(
        () =>
          ctx.contextMenus.register({
            id: 'chatshifter.move',
            target: 'session',
            order: MENU_ORDER,
            observe: () => [ctx.workspaces.list, ctx.locale],
            resolve: (target) => buildActions(ctx, target),
          }),
        'chatshifter: move-to-workspace session menu',
      )
    }

    exports.name = 'dsh-chatshifter'
    exports.inject = ['contextMenus', 'workspaces', 'sessions', 'remote', 'locale']
    exports.apply = apply
    /** Dictionaries exposed for the repository's consistency tests. */
    exports.__locales = DICTIONARIES
    return module.exports
  },
})
