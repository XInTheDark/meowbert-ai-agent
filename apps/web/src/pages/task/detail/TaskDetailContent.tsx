import { ConversationNavigationPane } from "./navigation/ConversationNavigationPane";
import "./navigation/conversationNavigation.css";
import type { CSSProperties } from "react";
import { RenderErrorBoundary } from "../../../components/RenderErrorBoundary";
import { ToolActivityInspectorPanel } from "../../../components/taskConversation/ToolActivityInspectorPanel";
import { CanvasPickerModal } from "../../../components/modals/CanvasPickerModal";
import { ProjectFilePickerModal } from "../../../components/modals/ProjectFilePickerModal";
import { SourceFilePickerModal } from "../../../components/modals/SourceFilePickerModal";
import { buildTaskRoutePath } from "../../../task/taskRouteContext";
import { canSelectTaskModel } from "../../../task/taskModelSelection";
import { getEffectiveTaskStatus } from "../../../lib/utils";
import { TaskDetailArtifactsPane } from "./TaskDetailArtifactsPane";
import { TaskDetailConversationPane } from "./TaskDetailConversationPane";
import { ProjectMasterComposerSuggestions } from "./ProjectMasterComposerSuggestions";
import { ProjectMasterGreeting } from "./ProjectMasterGreeting";
import { TaskConversationSearchPanel } from "./TaskConversationSearchPanel";
import { TaskDetailDebugPane } from "./TaskDetailDebugPane";
import { TaskDetailEventsPane } from "./TaskDetailEventsPane";
import { TaskDetailNotificationsPane } from "./TaskDetailNotificationsPane";
import { PersistentShellsPanel } from "../../environment/overview/PersistentShellsPanel";
import { TaskMessageOutlinePanel } from "./TaskMessageOutlinePanel";
import { TaskThreadSidebar } from "./TaskThreadSidebar";
import { TaskDetailTopbar } from "./TaskDetailTopbar";
import { TaskDetailWorkflowStrip } from "./TaskDetailWorkflowStrip";
import { TaskWorkflowSidebar } from "./TaskWorkflowSidebar";
import type { TaskDetailLoadedController } from "./useTaskDetailLoadedController";

type ModelProps = { model: TaskDetailLoadedController };

function TaskTopbar({ model }: ModelProps) {
  const taskDetail = model.context.data.taskDetail;
  if (!taskDetail) return null;
  const task = taskDetail.task;
  const isTaskRunning = ["running", "starting", "queued"].includes(task.status);
  const displayStatus = getEffectiveTaskStatus({
    taskStatus: task.status,
    cancellationRequested: task.cancellation_requested,
    workflow: taskDetail.workflow
  });
  return (
    <TaskDetailTopbar
      task={task}
      displayStatus={displayStatus}
      persistentShellCount={model.persistentShells.items.length}
      subtasks={taskDetail.subtasks ?? []}
      isTaskRunning={isTaskRunning}
      isCompacting={model.actions.isCompacting}
      isClearingContext={model.actions.isClearingContext}
      isScheduleActionBusy={model.actions.isScheduleActionBusy}
      topbarCollapsed={model.controllers.conversation.topbarCollapsed}
      isMobileViewport={model.view.layout.isMobileViewport}
      onExpandRequested={() => {
        model.view.setActionsMenuOpen(false);
        model.controllers.conversation.expandTopbar();
      }}
      activeTab={model.view.tab}
      onTabChange={model.controllers.switchTab}
      actionsMenuRef={model.view.actionsMenuRef}
      actionsMenuOpen={model.view.actionsMenuOpen}
      onActionsMenuToggle={() => model.view.setActionsMenuOpen((current) => !current)}
      onViewFiles={() => {
        model.actions.handleViewFiles();
        model.view.setActionsMenuOpen(false);
      }}
      onOpenTaskFolder={() => {
        void model.actions.handleOpenTaskFolder();
        model.view.setActionsMenuOpen(false);
      }}
      canOpenTaskFolder={model.context.runtime.capabilities.supportsRevealPath
        && model.context.runtime.activeServerProfile?.mode === "local"}
      onExportJson={() => {
        void model.actions.handleExportChat("json");
        model.view.setActionsMenuOpen(false);
      }}
      onExportMarkdown={() => {
        void model.actions.handleExportChat("md");
        model.view.setActionsMenuOpen(false);
      }}
      isExportingChat={model.actions.isExportingChat}
      onCompactContext={() => {
        void model.actions.handleCompactContext();
        model.view.setActionsMenuOpen(false);
      }}
      onClearContext={() => {
        void model.actions.handleClearContext();
        model.view.setActionsMenuOpen(false);
      }}
      contextChipExpanded={model.view.contextChipExpanded}
      onContextChipExpandedChange={model.view.setContextChipExpanded}
      onPauseSchedule={() => void model.actions.runScheduleAction(
        "pause",
        task.task_type === "timed" ? "Timed run stopped." : "Recurring schedule paused."
      )}
      onResumeSchedule={() => void model.actions.runScheduleAction(
        "resume",
        task.task_type === "timed" ? "Timed run started." : "Recurring schedule resumed."
      )}
      onRunNowSchedule={() => void model.actions.runScheduleAction(
        "run-now",
        task.task_type === "timed" ? "Timed run triggered." : "Recurring run triggered."
      )}
      onOpenSubtask={(subtaskId) => {
        if (!model.context.taskWorkspaceId || !model.context.taskProjectId) return;
        model.context.navigate(buildTaskRoutePath({
          workspaceId: model.context.taskWorkspaceId,
          projectId: model.context.taskProjectId,
          taskId: subtaskId
        }));
      }}
      latestContextUsage={taskDetail.latest_context_usage}
      messageDisplayPreferences={model.actions.messageDisplayPreferences}
      onMessageDisplayPreferencesChange={(next) => void model.actions.handleMessageDisplayPreferencesChange(next)}
      isMessageDisplayPreferencesSaving={model.actions.isMessageDisplayPreferencesSaving}
      newMessageOrganizationEnabled={model.organization.enabled}
      isConversationOutlineOpen={model.organization.isOpen && model.organization.view === "outline"}
      onConversationOutlineToggle={() => { model.controllers.search.setIsSearchOpen(false); model.organization.toggle("outline"); model.view.setActionsMenuOpen(false); }}
      isMessageOutlineOpen={model.organization.enabled ? model.organization.isOpen && model.organization.view !== "outline" : model.view.layout.isMessageOutlineOpen}
      onMessageOutlineToggle={model.organization.enabled ? () => { model.controllers.search.setIsSearchOpen(false); model.organization.toggleMessages(); model.view.setActionsMenuOpen(false); } : () => model.view.layout.setIsMessageOutlineOpen((current) => {
        if (!current) model.controllers.search.setIsSearchOpen(false);
        return !current;
      })}
      onOpenMobileNavigation={model.context.workspace.openMobileNavigation}
      onOpenSearch={undefined}
      onDeletePermanently={() => void model.actions.handleDeletePermanently()}
      isDeletingPermanently={model.actions.isDeletingPermanently}
      workflowStrip={taskDetail.workflow ? (
        <TaskDetailWorkflowStrip
          workflow={taskDetail.workflow}
          sidebar={model.view.workflowSidebar}
        />
      ) : null}
      subscriptionUsageWarning={model.context.subscriptionUsageWarning}
      debugMode={model.debugModeEnabled}
    />
  );
}

function TaskConversationNavigation({ model }: ModelProps) {
  const showOutline = !model.organization.enabled && model.view.layout.isMessageOutlineOpen;
  const showSearch = model.controllers.search.isSearchOpen;
  const mobile = model.view.layout.isMobileViewport;
  return (
    <>
      {showOutline && mobile ? (
        <button type="button" className="task-message-outline-backdrop" aria-label="Hide messages panel"
          onClick={() => model.view.layout.setIsMessageOutlineOpen(false)} />
      ) : null}
      {showSearch && mobile ? (
        <button type="button" className="task-search-panel-backdrop" aria-label="Hide search"
          onClick={() => model.controllers.search.setIsSearchOpen(false)} />
      ) : null}
      {showOutline ? (
        <TaskMessageOutlinePanel
          messages={model.controllers.conversation.outlineMessages}
          chatFeedRef={model.controllers.conversation.chatFeedRef}
          isMobileDrawer={mobile}
          onClose={() => model.view.layout.setIsMessageOutlineOpen(false)}
          onMessageRequested={model.controllers.conversation.jumpToMessage}
        />
      ) : null}
      {showSearch ? (
        <TaskConversationSearchPanel
          api={model.context.workspace.api}
          taskId={model.context.taskId}
          activeLeafMessageId={model.context.data.activeLeafMessageId
            ?? model.context.data.taskDetail?.active_leaf_message_id
            ?? null}
          chatFeedRef={model.controllers.conversation.chatFeedRef}
          isMobileDrawer={mobile}
          onResultSelected={model.controllers.search.handleSearchResultSelected}
          onSelectedResultChange={model.controllers.search.handleSearchSelectedResultChange}
          onClose={() => model.controllers.search.setIsSearchOpen(false)}
        />
      ) : null}
    </>
  );
}

function TaskConversationMain({ model }: ModelProps) {
  const task = model.context.data.taskDetail?.task;
  if (!task) return null;
  const conversation = model.controllers.conversation;
  const events = model.controllers.events;
  const threads = model.controllers.threads;
  return (
    <div className="task-detail-conversation-main">
      <TaskDetailConversationPane
        taskId={model.context.taskId}
        messages={conversation.messages}
        assistantMessageDisplayPreferences={model.actions.messageDisplayPreferences}
        showMessageAuthors={model.showMessageAuthors}
        isConversationBootstrapping={conversation.isConversationBootstrapping}
        isConversationPageLoading={conversation.isConversationPageLoading}
        conversationPageLoadDirection={conversation.conversationPageLoadDirection}
        isTaskRunning={["running", "starting", "queued"].includes(task.status)}
        isThinking={events.isThinking}
        chatFeedRef={conversation.chatFeedRef}
        onScroll={conversation.handleConversationScroll}
        onWheel={conversation.handleConversationWheel}
        onConversationChanged={model.context.data.loadTask}
        onEditRequested={model.beginEditMessage}
        renderBranchSwitcher={model.controllers.branch.renderBranchSwitcher}
        threadCountsByParentMessageId={threads.threadCountsByParentMessageId}
        threadSummariesByParentMessageId={threads.threadSummariesByParentMessageId}
        onThreadComposerRequested={threads.handleThreadComposerRequested}
        quotedFollowUpSelections={threads.quotedFollowUpSelections}
        onAssistantSelectionChange={threads.setSelectedTextDraft}
        onQuoteSelection={threads.handleQuoteSelection}
        onAskSelectionInThread={threads.handleAskSelectionInThread}
        onOpenSelectionThreads={threads.handleOpenSelectionThreads}
        onSubmitSelectionThread={threads.handleSubmitSelectionThread}
        onRemoveQuotedSelection={threads.handleRemoveQuotedSelection}
        onThreadListRequested={threads.handleThreadListRequested}
        enableThreadSelectionPopup={model.context.taskUiPreferences.enableThreadsPopup
          && model.actions.messageDisplayPreferences.showSelectionThreadActions}
        liveToolCalls={events.liveToolCalls}
        onInterruptLiveToolCall={events.handleInterruptLiveToolCall}
        interruptingLiveToolCallIds={events.interruptingLiveToolCallIds}
        hydratedMessageIds={conversation.hydratedMessageIds}
        onToolGroupExpandRequested={conversation.handleToolGroupExpandRequested}
        toolInspectorSelection={model.controllers.inspectorSelection}
        onToolInspectorSelectionChange={model.view.setActivityInspectorSelection}
        toolDisclosureState={model.view.toolDisclosureState}
        onToolDisclosureStateChange={model.view.setToolDisclosureState}
        buildInlineArtifactUrl={model.buildInlineArtifactUrl}
        isMobileViewport={model.view.layout.isMobileViewport}
        isMobileInputExpanded={model.view.layout.isMobileInputExpanded}
        onMobileInputExpandedChange={model.view.layout.setIsMobileInputExpanded}
        editingMessageId={model.composer.editingMessageId}
        onCancelEdit={model.cancelEditMessage}
        isBusy={model.actions.isBusy}
        followUp={model.composer.followUp}
        onFollowUpChange={model.composer.setFollowUp}
        onSubmit={() => void model.actions.handleSendFollowUp()}
        attachments={model.composer.attachments}
        onRemoveAttachment={model.composer.removeAttachment}
        onToggleAttachmentForceInclude={model.composer.toggleAttachmentForceInclude}
        onAttachFiles={model.composer.uploadFiles}
        onOpenProjectFiles={() => model.view.setIsProjectFilePickerOpen(true)}
        onOpenCanvases={() => model.view.setIsCanvasPickerOpen(true)}
        isUploading={model.composer.isUploading}
        pendingUploads={model.composer.pendingUploads}
        toolOptions={model.composer.toolOptions}
        taskParameters={model.composer.taskParameters}
        taskType={task.task_type}
        workflowConfig={model.composer.workflowConfig}
        showMemorySearch={model.context.workspaceMemoryEnabled}
        showComputerUse={model.context.runtime.capabilities.isDesktop}
        onToolOptionsChange={model.composer.handleToolOptionsChange}
        onTaskParametersChange={model.actions.handleTaskParametersChange}
        onWorkflowConfigChange={model.actions.handleWorkflowChange}
        onStop={() => void model.actions.handleCancelTask()}
        availableSkills={model.context.catalog.availableSkills}
        availableSources={model.context.catalog.availableSources}
        attachableSources={model.context.catalog.attachableSources}
        availableAgents={model.context.catalog.availableAgents}
        selectedAgentId={model.composer.selectedAgentId}
        defaultAgentId={model.context.catalog.defaultAgentId}
        modelSliderAgentIds={model.context.catalog.modelSliderAgentIds}
        onAgentChange={model.composer.handleAgentChange}
        onSourceSetupRequested={() => {
          if (model.context.taskWorkspaceId) {
            model.context.navigate(`/app/${model.context.taskWorkspaceId}/connectors?tab=sources`);
          }
        }}
        onOpenSourceFiles={model.view.setSelectedSource}
        showAgentSwitcher={canSelectTaskModel(model.context.workspace.user)}
        errorText={model.context.error || model.composer.uploadError}
        submitWithShiftEnter={model.context.taskUiPreferences.sendWithShiftEnter}
        subscriptionUsageWarning={model.context.subscriptionUsageWarning}
        searchSelectedMessageId={model.controllers.search.searchSelectedMessageId}
        searchForceExpandedMessageIds={model.controllers.search.searchForceExpandedMessageIds}
        searchSelectedMatch={model.controllers.search.searchSelectedMatch}
        isNearBottom={conversation.isNearBottom}
        showScrollToBottomButton={model.actions.messageDisplayPreferences.showScrollToBottomButton}
        onScrollToBottomRequested={model.controllers.search.handleScrollToBottomRequested}
        emptyConversation={task.is_project_master && !events.isThinking ? <ProjectMasterGreeting /> : null}
        composerAccessory={task.is_project_master ? (
          <ProjectMasterComposerSuggestions
            api={model.context.workspace.api}
            workspaceId={model.context.taskWorkspaceId}
            projectId={model.context.taskProjectId}
            visible={!model.composer.followUp.trim() && !model.composer.editingMessageId}
            onSelect={(action) => model.composer.setFollowUp(action.prompt)}
          />
        ) : null}
      />
    </div>
  );
}

function TaskActivitySidebar({ model }: ModelProps) {
  if (!model.controllers.inspectorSelection) return null;
  return (
    <div className="task-activity-sidebar">
      <ToolActivityInspectorPanel
        selection={model.controllers.inspectorSelection}
        hydratedMessageIds={model.controllers.conversation.hydratedMessageIds}
        toolDisclosureState={model.view.toolDisclosureState}
        interruptingLiveToolCallIds={model.controllers.events.interruptingLiveToolCallIds}
        onClose={() => model.view.setActivityInspectorSelection(null)}
        onToolDisclosureChange={(key, open) => model.view.setToolDisclosureState((current) => (
          current[key] === open ? current : { ...current, [key]: open }
        ))}
        onInterruptLiveToolCall={model.controllers.events.handleInterruptLiveToolCall}
        onExpandRequested={model.controllers.conversation.handleToolGroupExpandRequested}
        variant="docked"
      />
    </div>
  );
}

function TaskThreadsSidebar({ model }: ModelProps) {
  if (model.controllers.inspectorSelection || model.controllers.threads.threadSidebarStack.length === 0) return null;
  const threads = model.controllers.threads;
  return (
    <TaskThreadSidebar
      api={model.context.workspace.api}
      token={model.context.workspace.token}
      activeProjectId={model.context.taskProjectId}
      activeEnvironmentId={model.context.taskProjectId}
      activeWorkspaceId={model.context.taskWorkspaceId}
      workspaceMemoryEnabled={model.context.workspaceMemoryEnabled}
      allowComputerUse={model.context.runtime.capabilities.isDesktop}
      availableSkills={model.context.catalog.availableSkills}
      availableSources={model.context.catalog.availableSources}
      attachableSources={model.context.catalog.attachableSources}
      availableAgents={model.context.catalog.availableAgents}
      defaultAgentId={model.context.catalog.defaultAgentId}
      modelSliderAgentIds={model.context.catalog.modelSliderAgentIds}
      selectedAgentId={model.composer.selectedAgentId}
      showAgentSwitcher={canSelectTaskModel(model.context.workspace.user)}
      enableThreadSelectionPopup={model.context.taskUiPreferences.enableThreadsPopup}
      submitWithShiftEnter={model.context.taskUiPreferences.sendWithShiftEnter}
      onSourceSetupRequested={() => {
        if (model.context.taskWorkspaceId) {
          model.context.navigate(`/app/${model.context.taskWorkspaceId}/connectors?tab=sources`);
        }
      }}
      initialToolOptions={{ ...model.composer.toolOptions, scheduleTask: false, subtasks: false }}
      assistantMessageDisplayPreferences={model.actions.messageDisplayPreferences}
      showMessageAuthors={model.showMessageAuthors}
      stack={threads.threadSidebarStack}
      onBack={threads.closeTopThreadPanel}
      onClose={threads.closeThreadSidebar}
      onOpenList={threads.openThreadList}
      onOpenComposer={threads.openThreadComposer}
      onOpenConversation={threads.openThreadConversation}
      onRootRefreshRequested={model.context.data.loadTask}
    />
  );
}

function TaskWorkflowRightSidebar({ model }: ModelProps) {
  const workflow = model.context.data.taskDetail?.workflow;
  if (!workflow || !model.view.workflowSidebar.isWorkflowSidebarOpen || model.controllers.inspectorSelection) {
    return null;
  }
  return (
    <TaskWorkflowSidebar
      api={model.context.workspace.api}
      taskId={model.context.taskId}
      workflow={workflow}
      sidebar={model.view.workflowSidebar}
    />
  );
}

function TaskConversationLayout({ model }: ModelProps) {
  if (model.view.tab !== "conversation") return null;
  const showOutline = !model.organization.enabled && model.view.layout.isMessageOutlineOpen;
  const showSearch = model.controllers.search.isSearchOpen;
  const hasActivity = model.controllers.inspectorSelection !== null;
  const hasWorkflow = Boolean(model.context.data.taskDetail?.workflow && model.view.workflowSidebar.isWorkflowSidebarOpen);
  const hasThreads = model.controllers.threads.threadSidebarStack.length > 0;
  const hasRightSidebar = hasActivity || hasWorkflow || hasThreads;
  const mobile = model.view.layout.isMobileViewport;
  const navigation = model.organization;
  const showNavigation = navigation.enabled && navigation.isOpen && !showSearch;
  const overlay = navigation.expanded || mobile || navigation.containerWidth < navigation.width + 640 + (hasRightSidebar ? model.view.layout.threadSidebarWidth + 10 : 0);
  const className = [
    "task-detail-conversation-shell",
    showNavigation && !overlay ? "has-conversation-navigation" : "",
    showOutline ? "has-message-outline" : "",
    showSearch ? "has-search-panel" : "",
    hasRightSidebar ? "has-right-sidebar" : "",
    hasWorkflow && !hasActivity ? "has-workflow-sidebar" : "",
    hasThreads && !hasActivity && !hasWorkflow ? "has-thread-sidebar" : "",
    hasActivity ? "has-activity-sidebar" : "",
    showOutline && mobile ? "message-outline-mobile-open" : "",
    showSearch && mobile ? "search-panel-mobile-open" : ""
  ].filter(Boolean).join(" ");
  return (
    <div ref={navigation.containerRef} className={className} style={{ "--thread-sidebar-width": `${model.view.layout.threadSidebarWidth}px`, "--conversation-navigation-width": `${navigation.width}px` } as CSSProperties}>
      {navigation.enabled ? <ConversationNavigationPane key={model.context.taskId} controller={{ ...navigation, isOpen: showNavigation }} overlay={overlay}
        summaries={model.actions.messageDisplayPreferences.showMessageSummaries !== false}
        chatFeedRef={model.controllers.conversation.chatFeedRef} onJump={model.controllers.conversation.jumpToMessage} /> : null}
      <TaskConversationNavigation model={model} />
      <TaskConversationMain model={model} />
      {hasRightSidebar && !mobile ? (
        <div
          className="thread-sidebar-resize-handle"
          onMouseDown={model.view.layout.beginThreadSidebarResize}
          role="separator"
          aria-orientation="vertical"
          aria-label={hasActivity ? "Resize activity panel" : hasWorkflow ? "Resize workflow sidebar" : "Resize thread sidebar"}
        />
      ) : null}
      <TaskActivitySidebar model={model} />
      <TaskWorkflowRightSidebar model={model} />
      {!hasWorkflow ? <TaskThreadsSidebar model={model} /> : null}
    </div>
  );
}

function TaskSecondaryTabs({ model }: ModelProps) {
  const tab = model.view.tab;
  if (tab === "events") {
    return (
      <TaskDetailEventsPane
        events={model.controllers.events.events}
        isBootstrapping={model.controllers.events.isEventsBootstrapping}
        isPageLoading={model.controllers.events.isEventsPageLoading}
        eventsFeedRef={model.controllers.events.eventsFeedRef}
        onScroll={model.controllers.events.handleEventsScroll}
      />
    );
  }
  if (tab === "notifications") {
    return <TaskDetailNotificationsPane events={model.controllers.events.notificationEvents} />;
  }
  if (tab === "shells") {
    return (
      <div className="page-content task-tab-pane">
        <PersistentShellsPanel
          title="Shells created by this task"
          description="Read-only live output from persistent shell sessions created by this task."
          items={model.persistentShells.items}
          isLoading={model.persistentShells.isLoading}
          error={model.persistentShells.error}
          onRefresh={model.persistentShells.refresh}
          onTerminate={model.persistentShells.terminateSession}
          onTerminateAll={model.persistentShells.terminateAll}
          emptyMessage="This task has not created any shells."
        />
      </div>
    );
  }
  if (tab === "artifacts") {
    return (
      <TaskDetailArtifactsPane
        api={model.context.workspace.api}
        token={model.context.workspace.token}
        projectId={model.context.taskProjectId!}
        taskRootPath={model.context.taskRootPath}
        artifacts={model.context.data.artifacts}
        canvases={model.context.data.artifactCanvases}
        isDownloadingArtifact={model.actions.isDownloadingArtifact}
        onOpenCanvas={(canvasId) => {
          if (model.context.taskWorkspaceId && model.context.taskProjectId) {
            model.context.navigate(`/app/${model.context.taskWorkspaceId}/projects/${model.context.taskProjectId}/canvases/${canvasId}`);
          }
        }}
        onDownloadArtifact={(relativePath) => void model.actions.handleDownloadArtifact(relativePath)}
      />
    );
  }
  if (tab === "debug" && model.debugModeEnabled) {
    return (
      <TaskDetailDebugPane
        api={model.context.workspace.api}
        taskId={model.context.taskId}
        events={model.controllers.events.events}
      />
    );
  }
  return null;
}

function TaskDetailModals({ model }: ModelProps) {
  return (
    <>
      <ProjectFilePickerModal
        api={model.context.workspace.api}
        projectId={model.context.taskProjectId!}
        environmentId={model.context.taskProjectId!}
        isOpen={model.view.isProjectFilePickerOpen}
        onClose={() => model.view.setIsProjectFilePickerOpen(false)}
        onSelect={model.composer.appendAttachments}
      />
      <CanvasPickerModal
        api={model.context.workspace.api}
        projectId={model.context.taskProjectId!}
        isOpen={model.view.isCanvasPickerOpen}
        onClose={() => model.view.setIsCanvasPickerOpen(false)}
        onAttach={(attachment) => model.composer.appendAttachments([attachment])}
        onOpenInCanvasMode={(canvas) => {
          model.view.setSelectedFollowUpCanvas(canvas);
          model.composer.appendAttachments([{
            id: crypto.randomUUID(),
            kind: "canvas",
            label: canvas.name,
            content: `Canvas: ${canvas.name}`,
            relativePath: canvas.rootPath
          }]);
          if (model.context.taskWorkspaceId && model.context.taskProjectId) {
            model.context.navigate(`/app/${model.context.taskWorkspaceId}/projects/${model.context.taskProjectId}/canvases/${canvas.id}`);
          }
        }}
      />
      <SourceFilePickerModal
        api={model.context.workspace.api}
        workspaceId={model.context.taskWorkspaceId}
        projectId={model.context.taskProjectId!}
        environmentId={model.context.taskProjectId!}
        taskId={model.context.taskId}
        source={model.view.selectedSource}
        isOpen={model.view.selectedSource !== null}
        onClose={() => model.view.setSelectedSource(null)}
        onSelect={model.composer.appendAttachments}
        destinationPath={model.composer.uploadPath}
        createDirectories
        toAttachmentPath={model.composer.toAttachmentPath}
      />
    </>
  );
}

export function TaskDetailContent({ model }: ModelProps) {
  return (
    <div className="chat-layout task-detail-chat-layout">
      <RenderErrorBoundary
        resetKey={model.context.taskId}
        fallback={(error) => (
          <section className="page-content">
            <article className="section-card empty-card" style={{ maxWidth: "40rem", margin: "0 auto" }}>
              <h3>Couldn&apos;t render task</h3>
              <p className="error-text" style={{ marginTop: "0.35rem" }}>
                {error.message || "The task view crashed while rendering."}
              </p>
            </article>
          </section>
        )}
      >
        {model.context.data.taskLoadError ? <div className="error-banner">{model.context.data.taskLoadError}</div> : null}
        <TaskTopbar model={model} />
        <TaskConversationLayout model={model} />
        <TaskSecondaryTabs model={model} />
        <TaskDetailModals model={model} />
      </RenderErrorBoundary>
    </div>
  );
}
