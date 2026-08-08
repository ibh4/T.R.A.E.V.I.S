/**
 * T.A.R.E.V.I.S. MCP Server
 * 通过 MCP 协议提供 TRAE 工作状态
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ResourceUpdatedNotification
} from '@modelcontextprotocol/sdk/types.js';
import { StatusDetector } from './status-detector.js';
import { TraeWorkStatus, StatusInfo, MonitorConfig } from './types.js';
import { TraePalScreenModel } from './traepal-screen-model.js';
import { HomeScreenModel } from './home/home-screen-model.js';
import { HomeEventScenario } from './home/home-types.js';

export class TraeStatusServer {
  private server: Server;
  private detector: StatusDetector;
  private config: MonitorConfig;
  private screenModel: TraePalScreenModel;
  private homeScreenModel: HomeScreenModel;

  constructor(
    detector: StatusDetector,
    config: MonitorConfig,
    screenModel: TraePalScreenModel,
    homeScreenModel: HomeScreenModel
  ) {
    this.detector = detector;
    this.config = config;
    this.screenModel = screenModel;
    this.homeScreenModel = homeScreenModel;

    this.server = new Server(
      {
        name: 'trae-status-monitor',
        version: '0.1.0'
      },
      {
        capabilities: {
          resources: {},
          tools: {}
        }
      }
    );

    this.setupResourceHandlers();
    this.setupToolHandlers();
    this.setupNotifications();
  }

  /**
   * 启动 MCP Server
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[TraeStatusServer] MCP Server started on stdio');
  }

  /**
   * 设置资源处理程序
   */
  private setupResourceHandlers(): void {
    // 列出可用资源
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: 'trae://status/current',
            name: 'Current TRAE Status',
            description: 'Current working status of TRAE (idle, thinking, working, etc.)',
            mimeType: 'application/json'
          },
          {
            uri: 'trae://status/projects',
            name: 'Project Status List',
            description: 'Status of all monitored projects',
            mimeType: 'application/json'
          },
          {
            uri: 'trae://status/details',
            name: 'Detailed Status Information',
            description: 'Detailed status information including activity metrics',
            mimeType: 'application/json'
          },
          {
            uri: 'trae://status/traepal-screen',
            name: 'TraePal Screen State',
            description: 'Compact project list, detail, progress and three-choice payload for TraePal',
            mimeType: 'application/json'
          },
          {
            uri: 'trae://status/home-screen',
            name: 'Home Screen State',
            description: 'Compact home event list, current priority event and three-choice payload for TraePal',
            mimeType: 'application/json'
          }
        ]
      };
    });

    // 读取资源
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;

      switch (uri) {
        case 'trae://status/current':
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(this.detector.getCurrentStatus(), null, 2)
              }
            ]
          };

        case 'trae://status/projects':
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(this.getProjectStatuses(), null, 2)
              }
            ]
          };

        case 'trae://status/details':
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(this.getDetailedStatus(), null, 2)
              }
            ]
          };

        case 'trae://status/traepal-screen':
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(this.screenModel.getScreenState(), null, 2)
              }
            ]
          };

        case 'trae://status/home-screen':
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(this.homeScreenModel.getHomeScreenState(), null, 2)
              }
            ]
          };

        default:
          throw new Error(`Unknown resource URI: ${uri}`);
      }
    });
  }

  /**
   * 设置工具处理程序
   */
  private setupToolHandlers(): void {
    // 列出可用工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_current_status',
            description: 'Get the current TRAE working status',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'set_status',
            description: 'Manually set the TRAE working status',
            inputSchema: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  enum: Object.values(TraeWorkStatus),
                  description: 'The status to set'
                },
                message: {
                  type: 'string',
                  description: 'Optional message describing the status'
                }
              },
              required: ['status']
            }
          },
          {
            name: 'record_build_result',
            description: 'Record a build result (success or failure)',
            inputSchema: {
              type: 'object',
              properties: {
                success: {
                  type: 'boolean',
                  description: 'Whether the build succeeded'
                },
                errorMessage: {
                  type: 'string',
                  description: 'Error message if build failed'
                }
              },
              required: ['success']
            }
          },
          {
            name: 'get_projects',
            description: 'Get status of all monitored projects',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'get_traepal_screen',
            description: 'Get the compact TraePal screen state for ESP32 or preview UI',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'submit_user_choice',
            description: 'Record a TraePal touch choice from the three-option screen',
            inputSchema: {
              type: 'object',
              properties: {
                projectId: {
                  type: 'string',
                  description: 'Project id from the TraePal screen payload'
                },
                choiceId: {
                  type: 'string',
                  enum: ['a', 'b', 'c'],
                  description: 'Selected option id'
                },
                label: {
                  type: 'string',
                  description: 'Optional label displayed on the device'
                }
              },
              required: ['projectId', 'choiceId']
            }
          },
          {
            name: 'get_home_screen',
            description: 'Get the compact home event screen state for preview UI',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'trigger_home_event',
            description: 'Trigger a mock home event for demo and integration testing',
            inputSchema: {
              type: 'object',
              properties: {
                scenario: {
                  type: 'string',
                  enum: ['delivery', 'visitor', 'door', 'kitchen', 'fall'],
                  description: 'Mock home scenario to trigger'
                }
              },
              required: ['scenario']
            }
          },
          {
            name: 'submit_home_choice',
            description: 'Record a TraePal touch choice for the current home event',
            inputSchema: {
              type: 'object',
              properties: {
                eventId: {
                  type: 'string',
                  description: 'Home event id from the home screen payload'
                },
                choiceId: {
                  type: 'string',
                  enum: ['a', 'b', 'c'],
                  description: 'Selected option id'
                },
                label: {
                  type: 'string',
                  description: 'Optional label displayed on the device'
                }
              },
              required: ['eventId', 'choiceId']
            }
          }
        ]
      };
    });

    // 调用工具
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'get_current_status':
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(this.detector.getCurrentStatus(), null, 2)
                }
              ],
              isError: false
            };

          case 'set_status':
            if (!args || !args.status) {
              throw new Error('Status is required');
            }
            this.detector.setStatus(args.status as TraeWorkStatus, args.message as string);
            return {
              content: [
                {
                  type: 'text',
                  text: `Status set to ${args.status}`
                }
              ],
              isError: false
            };

          case 'record_build_result':
            if (typeof args?.success !== 'boolean') {
              throw new Error('success parameter is required');
            }
            this.detector.recordBuildResult(args.success, args.errorMessage as string);
            return {
              content: [
                {
                  type: 'text',
                  text: `Build result recorded: ${args.success ? 'success' : 'failure'}`
                }
              ],
              isError: false
            };

          case 'get_projects':
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(this.getProjectStatuses(), null, 2)
                }
              ],
              isError: false
            };

          case 'get_traepal_screen':
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(this.screenModel.getScreenState(), null, 2)
                }
              ],
              isError: false
            };

          case 'submit_user_choice':
            if (!args?.projectId || !args?.choiceId) {
              throw new Error('projectId and choiceId are required');
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    this.screenModel.submitChoice({
                      projectId: String(args.projectId),
                      choiceId: args.choiceId as 'a' | 'b' | 'c',
                      label: args.label ? String(args.label) : undefined
                    }),
                    null,
                    2
                  )
                }
              ],
              isError: false
            };

          case 'get_home_screen':
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(this.homeScreenModel.getHomeScreenState(), null, 2)
                }
              ],
              isError: false
            };

          case 'trigger_home_event':
            if (!args?.scenario || !this.isHomeScenarioName(String(args.scenario))) {
              throw new Error('scenario must be one of delivery, visitor, door, kitchen, fall');
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    this.homeScreenModel.triggerScenario(args.scenario as HomeEventScenario),
                    null,
                    2
                  )
                }
              ],
              isError: false
            };

          case 'submit_home_choice':
            if (!args?.eventId || !args?.choiceId) {
              throw new Error('eventId and choiceId are required');
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    this.homeScreenModel.submitChoice({
                      eventId: String(args.eventId),
                      choiceId: args.choiceId as 'a' | 'b' | 'c',
                      label: args.label ? String(args.label) : undefined
                    }),
                    null,
                    2
                  )
                }
              ],
              isError: false
            };

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : String(error)
            }
          ],
          isError: true
        };
      }
    });
  }

  /**
   * 设置状态更新通知
   */
  private setupNotifications(): void {
    this.detector.on('statusUpdate', (status: StatusInfo) => {
      // 通知客户端状态更新
      this.server.notification({
        method: 'notifications/resources/updated',
        params: {
          uri: 'trae://status/current'
        }
      }).catch(() => {
        // 忽略通知错误
      });
    });

    this.homeScreenModel.on('homeUpdate', () => {
      this.server.notification({
        method: 'notifications/resources/updated',
        params: {
          uri: 'trae://status/home-screen'
        }
      }).catch(() => {
        // 忽略通知错误
      });
    });
  }

  /**
   * 获取项目状态列表
   */
  private getProjectStatuses(): object[] {
    const currentStatus = this.detector.getCurrentStatus();
    return this.detector.getProjectStatuses().map((project) => ({
      id: project.id,
      name: project.name,
      path: project.path,
      status: currentStatus.status,
      message: currentStatus.message,
      lastActivity: currentStatus.details?.lastActivity,
      errorCount: currentStatus.details?.errorCount || 0,
      fileCount: project.fileCount,
      lastModified: project.lastModified
    }));
  }

  /**
   * 获取详细状态信息
   */
  private getDetailedStatus(): object {
    const currentStatus = this.detector.getCurrentStatus();

    return {
      currentStatus: currentStatus.status,
      message: currentStatus.message,
      timestamp: currentStatus.timestamp,
      lastActivity: currentStatus.details?.lastActivity,
      fileChangeCount: currentStatus.details?.fileCount || 0,
      errorCount: currentStatus.details?.errorCount || 0,
      availableStatuses: Object.values(TraeWorkStatus),
      config: {
        idleTimeout: this.config.idleTimeout,
        heartbeatInterval: this.config.heartbeatInterval
      }
    };
  }

  private isHomeScenarioName(value: string): value is HomeEventScenario {
    return ['delivery', 'visitor', 'door', 'kitchen', 'fall'].includes(value);
  }
}
