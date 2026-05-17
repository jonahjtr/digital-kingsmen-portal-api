import {
  UserRole,
  ProjectStatus,
  StepStatus,
  UpdateVisibility,
  ApprovalStatus,
  ConversationType,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { bootstrap } from '../src/bootstrap';
import { getPrisma } from '../src/lib/prisma';
import { ensureRegistrationTokens } from '../src/services/invite.service';

const DEMO_PASSWORD = 'Demo123!';

async function main() {
  console.log('Seeding database...');

  if (process.env.CF_SEED === '1') {
    const { getPlatformProxy } = await import('wrangler');
    const { env } = await getPlatformProxy({ configPath: './wrangler.toml' });
    await bootstrap({ DB: env.DB, R2: (env as { R2?: R2Bucket }).R2 });
  } else {
    await bootstrap();
  }

  const prisma = getPrisma();

  await prisma.nudge.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversationMember.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.approvalComment.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.file.deleteMany();
  await prisma.taskComment.deleteMany();
  await prisma.task.deleteMany();
  await prisma.projectUpdate.deleteMany();
  await prisma.serviceStep.deleteMany();
  await prisma.projectService.deleteMany();
  await prisma.projectTeamMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.clientRequest.deleteMany();
  await prisma.report.deleteMany();
  await prisma.internalNote.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.announcement.deleteMany();
  await prisma.invite.deleteMany();
  await prisma.companyUser.deleteMany();
  await prisma.company.deleteMany();
  await prisma.serviceTemplate.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@digitalkingsmen.com',
      passwordHash,
      fullName: 'Admin User',
      role: UserRole.admin,
      phone: '555-0100',
    },
  });

  const pm = await prisma.user.create({
    data: {
      email: 'pm@digitalkingsmen.com',
      passwordHash,
      fullName: 'Project Manager',
      role: UserRole.employee,
      phone: '555-0101',
    },
  });

  const salesman = await prisma.user.create({
    data: {
      email: 'salesman@digitalkingsmen.com',
      passwordHash,
      fullName: 'Sales Rep',
      role: UserRole.salesman,
      phone: '555-0102',
    },
  });

  const employee = await prisma.user.create({
    data: {
      email: 'employee@digitalkingsmen.com',
      passwordHash,
      fullName: 'Team Member',
      role: UserRole.employee,
      phone: '555-0103',
    },
  });

  const clientPure = await prisma.user.create({
    data: {
      email: 'client-pure@example.com',
      passwordHash,
      fullName: 'Pure Heating Contact',
      role: UserRole.client,
    },
  });

  const clientFour = await prisma.user.create({
    data: {
      email: 'client-four@example.com',
      passwordHash,
      fullName: 'Four Seasons Contact',
      role: UserRole.client,
    },
  });

  const clientClean = await prisma.user.create({
    data: {
      email: 'client-clean@example.com',
      passwordHash,
      fullName: 'Clean Slate Contact',
      role: UserRole.client,
    },
  });

  const templates = await Promise.all([
    prisma.serviceTemplate.create({
      data: {
        name: 'Website Build',
        description: 'Full website design and development',
        defaultStepsJson: [
          { name: 'Discovery', sort_order: 0 },
          { name: 'Design', sort_order: 1 },
          { name: 'Development', sort_order: 2 },
          { name: 'Launch', sort_order: 3 },
        ],
      },
    }),
    prisma.serviceTemplate.create({
      data: {
        name: 'SEO',
        description: 'Search engine optimization',
        defaultStepsJson: [
          { name: 'Audit', sort_order: 0 },
          { name: 'Keyword Research', sort_order: 1 },
          { name: 'On-Page', sort_order: 2 },
          { name: 'Reporting', sort_order: 3 },
        ],
      },
    }),
    prisma.serviceTemplate.create({
      data: {
        name: 'Google Ads',
        defaultStepsJson: [
          { name: 'Strategy', sort_order: 0 },
          { name: 'Setup', sort_order: 1 },
          { name: 'Optimization', sort_order: 2 },
        ],
      },
    }),
    prisma.serviceTemplate.create({
      data: { name: 'Branding', defaultStepsJson: [] },
    }),
    prisma.serviceTemplate.create({
      data: { name: 'Facebook Ads', defaultStepsJson: [] },
    }),
    prisma.serviceTemplate.create({
      data: { name: 'Local SEO', defaultStepsJson: [] },
    }),
    prisma.serviceTemplate.create({
      data: { name: 'Google Business Profile', defaultStepsJson: [] },
    }),
  ]);

  const [tplWebsite, tplSeo, tplGoogleAds, tplBranding, tplFacebook, tplLocalSeo, tplGbp] = templates;

  const companies = [
    {
      name: 'Pure Heating & Air',
      website: 'https://pureheating.example',
      industry: 'HVAC',
      client: clientPure,
      services: [
        { name: 'Website Build', templateId: tplWebsite.id, progress: 65 },
        { name: 'SEO', templateId: tplSeo.id, progress: 30 },
        { name: 'Google Ads', templateId: tplGoogleAds.id, progress: 20 },
      ],
    },
    {
      name: 'Four Seasons Pest Solutions',
      website: 'https://fourseasonspest.example',
      industry: 'Pest Control',
      client: clientFour,
      services: [
        { name: 'Website Build', templateId: tplWebsite.id, progress: 85 },
        { name: 'Local SEO', templateId: tplLocalSeo.id, progress: 45 },
        { name: 'Google Business Profile', templateId: tplGbp.id, progress: 40 },
      ],
    },
    {
      name: 'Clean Slate Contracting',
      website: 'https://cleanslate.example',
      industry: 'Contracting',
      client: clientClean,
      services: [
        { name: 'Branding', templateId: tplBranding.id, progress: 60 },
        { name: 'Website Updates', templateId: tplWebsite.id, progress: 35 },
        { name: 'Facebook Ads', templateId: tplFacebook.id, progress: 15 },
      ],
    },
  ];

  const updates = [
    'Homepage design is complete and ready for review.',
    'We are waiting on updated service photos.',
    'SEO keyword research is complete.',
    'Google Ads campaign structure is being prepared.',
    'Client requested revisions on the landing page.',
  ];

  for (const co of companies) {
    const company = await prisma.company.create({
      data: {
        name: co.name,
        website: co.website,
        industry: co.industry,
        mainContactName: co.client.fullName,
        mainContactEmail: co.client.email,
        assignedSalesmanId: salesman.id,
        assignedProjectManagerId: pm.id,
        status: 'active',
      },
    });

    await prisma.companyUser.create({
      data: {
        companyId: company.id,
        userId: co.client.id,
        relationshipType: 'primary_contact',
      },
    });

    let primaryProjectId: string | null = null;

    for (const svc of co.services) {
      const project = await prisma.project.create({
        data: {
          companyId: company.id,
          name: `${co.name} — ${svc.name}`,
          description: `${svc.name} engagement for ${co.name}`,
          status: ProjectStatus.in_progress,
          priority: 'normal',
          startDate: new Date('2025-01-15'),
          dueDate: new Date('2025-08-01'),
          assignedSalesmanId: salesman.id,
          projectManagerId: pm.id,
          overallProgress: svc.progress,
          clientFacingNotes: 'We are making great progress on your project!',
          internalNotes: 'High priority client - keep PM updated weekly.',
        },
      });

      if (!primaryProjectId) primaryProjectId = project.id;

      await prisma.projectTeamMember.createMany({
        data: [
          { projectId: project.id, userId: pm.id, roleOnProject: 'project_manager' },
          { projectId: project.id, userId: employee.id, roleOnProject: 'designer' },
          { projectId: project.id, userId: salesman.id, roleOnProject: 'salesman' },
        ],
      });

      const projectService = await prisma.projectService.create({
        data: {
          projectId: project.id,
          serviceTemplateId: svc.templateId,
          serviceName: svc.name,
          progress: svc.progress,
          manualProgressOverride: true,
          status: ProjectStatus.in_progress,
        },
      });

      const stepCount = 4;
      const completedSteps = Math.round((svc.progress / 100) * stepCount);
      for (let i = 0; i < stepCount; i++) {
        await prisma.serviceStep.create({
          data: {
            projectServiceId: projectService.id,
            name: `Step ${i + 1}`,
            sortOrder: i,
            status: i < completedSteps ? StepStatus.complete : StepStatus.not_started,
            completedAt: i < completedSteps ? new Date() : null,
          },
        });
      }
    }

    const project = { id: primaryProjectId! };

    for (let i = 0; i < updates.length; i++) {
      await prisma.projectUpdate.create({
        data: {
          projectId: project.id,
          title: updates[i].slice(0, 50),
          message: updates[i],
          postedBy: i % 2 === 0 ? pm.id : employee.id,
          visibility: i === 4 ? UpdateVisibility.client_visible : i % 3 === 0 ? UpdateVisibility.client_visible : UpdateVisibility.internal_only,
        },
      });
    }

    const clientConv = await prisma.conversation.create({
      data: { projectId: project.id, type: ConversationType.client_project },
    });
    const internalConv = await prisma.conversation.create({
      data: { projectId: project.id, type: ConversationType.internal_project },
    });

    await prisma.conversationMember.createMany({
      data: [
        { conversationId: clientConv.id, userId: co.client.id },
        { conversationId: clientConv.id, userId: pm.id },
        { conversationId: internalConv.id, userId: pm.id },
        { conversationId: internalConv.id, userId: employee.id },
        { conversationId: internalConv.id, userId: salesman.id },
      ],
    });

    await prisma.message.create({
      data: {
        conversationId: clientConv.id,
        senderId: pm.id,
        message: 'Welcome! Let us know if you have any questions about the project.',
        internalOnly: false,
      },
    });

    await prisma.message.create({
      data: {
        conversationId: internalConv.id,
        senderId: employee.id,
        message: 'Internal: waiting on brand assets from client.',
        internalOnly: true,
      },
    });

    await prisma.task.create({
      data: {
        projectId: project.id,
        title: 'Review homepage mockup',
        description: 'Client review needed',
        status: 'client_review',
        assignedTo: employee.id,
        clientVisible: true,
        createdBy: pm.id,
        dueDate: new Date(Date.now() + 7 * 86400000),
      },
    });

    await prisma.approval.create({
      data: {
        projectId: project.id,
        title: 'Homepage Design v2',
        description: 'Please review the updated homepage design',
        status: ApprovalStatus.waiting_for_client,
        requestedBy: pm.id,
      },
    });

    await prisma.internalNote.create({
      data: {
        projectId: project.id,
        companyId: company.id,
        createdBy: salesman.id,
        note: `Sales note: ${co.name} is a strong referral source.`,
      },
    });
  }

  await prisma.announcement.create({
    data: {
      title: 'Welcome to Digital Kingsmen Portal',
      message: 'Your project hub is live. Check your dashboard for updates and approvals.',
      audience: 'everyone',
      createdBy: admin.id,
    },
  });

  await ensureRegistrationTokens(admin.id);

  console.log('Seed completed.');
  console.log('Demo password for all users:', DEMO_PASSWORD);
  console.log('Admin:', admin.email);
  console.log('Reusable registration tokens (any email at /register):');
  console.log('  Client:    dk-register-client');
  console.log('  Team:      dk-register-employee');
  console.log('  Sales:     dk-register-salesman');
  console.log('  Admin:     dk-register-admin');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => getPrisma().$disconnect());
