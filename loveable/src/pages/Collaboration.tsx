
import React, { useState } from "react";
import { AuthenticatedLayout } from "@/components/layout/AuthenticatedLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, MessageSquare, FileText, Clock, UserPlus, Share2, Eye, CheckCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Collaboration = () => {
  const [activeUsers] = useState([
    { id: 1, name: "Sarah Johnson", role: "Partner", status: "online", avatar: "SJ" },
    { id: 2, name: "Michael Chen", role: "Associate", status: "reviewing", avatar: "MC" },
    { id: 3, name: "Emily Rodriguez", role: "Paralegal", status: "online", avatar: "ER" },
  ]);

  const [recentActivity] = useState([
    { id: 1, user: "Sarah Johnson", action: "reviewed", item: "Deposition Summary #1247", time: "2 minutes ago" },
    { id: 2, user: "Michael Chen", action: "commented on", item: "Case Analysis - Smith v. Jones", time: "15 minutes ago" },
    { id: 3, user: "Emily Rodriguez", action: "shared", item: "Witness Statement Summary", time: "1 hour ago" },
  ]);

  const [sharedSummaries] = useState([
    { id: 1, title: "Expert Witness Deposition - Dr. Martinez", collaborators: 3, comments: 8, lastUpdate: "Today, 2:30 PM" },
    { id: 2, title: "Plaintiff Deposition - Jennifer Smith", collaborators: 2, comments: 12, lastUpdate: "Yesterday, 4:15 PM" },
    { id: 3, title: "Corporate Representative Deposition", collaborators: 4, comments: 6, lastUpdate: "2 days ago" },
  ]);

  return (
    <AuthenticatedLayout>
      <div className="p-6 pt-20 lg:pt-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Team Collaboration</h1>
            <p className="text-slate-600 dark:text-slate-300">Work together seamlessly on case preparation and analysis</p>
          </div>
          <Button className="bg-[#5674BC] hover:bg-[#4a65a7] text-white">
            <UserPlus className="w-4 h-4 mr-2" />
            Invite Team Member
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">Active Users</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{activeUsers.length}</p>
                </div>
                <Users className="w-8 h-8 text-[#5674BC]" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">Shared Documents</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">24</p>
                </div>
                <Share2 className="w-8 h-8 text-[#5674BC]" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">Comments Today</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">47</p>
                </div>
                <MessageSquare className="w-8 h-8 text-[#5674BC]" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">Reviews Pending</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">12</p>
                </div>
                <Eye className="w-8 h-8 text-[#5674BC]" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="workspace" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="workspace">Team Workspace</TabsTrigger>
            <TabsTrigger value="activity">Recent Activity</TabsTrigger>
            <TabsTrigger value="shared">Shared Documents</TabsTrigger>
          </TabsList>

          <TabsContent value="workspace" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Active Team Members */}
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Active Team Members
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {activeUsers.map((user) => (
                    <div key={user.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-[#5674BC] text-white rounded-full flex items-center justify-center text-sm font-medium">
                          {user.avatar}
                        </div>
                        <div>
                          <p className="font-medium text-slate-900 dark:text-white">{user.name}</p>
                          <p className="text-sm text-slate-600 dark:text-slate-300">{user.role}</p>
                        </div>
                      </div>
                      <Badge variant={user.status === 'online' ? 'default' : 'secondary'}>
                        {user.status}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Collaboration Tools */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Collaboration Tools</CardTitle>
                  <CardDescription>Quick access to team collaboration features</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Button variant="outline" className="h-20 flex flex-col gap-2">
                      <MessageSquare className="w-6 h-6" />
                      <span>Team Chat</span>
                    </Button>
                    <Button variant="outline" className="h-20 flex flex-col gap-2">
                      <FileText className="w-6 h-6" />
                      <span>Document Review</span>
                    </Button>
                    <Button variant="outline" className="h-20 flex flex-col gap-2">
                      <Share2 className="w-6 h-6" />
                      <span>Share & Assign</span>
                    </Button>
                    <Button variant="outline" className="h-20 flex flex-col gap-2">
                      <CheckCircle className="w-6 h-6" />
                      <span>Approval Workflow</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="activity" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Recent Team Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {recentActivity.map((activity) => (
                    <div key={activity.id} className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                      <div className="w-2 h-2 bg-[#5674BC] rounded-full"></div>
                      <div className="flex-1">
                        <p className="text-slate-900 dark:text-white">
                          <span className="font-medium">{activity.user}</span> {activity.action}{" "}
                          <span className="font-medium">{activity.item}</span>
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-300">{activity.time}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="shared" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Shared Documents</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {sharedSummaries.map((summary) => (
                    <div key={summary.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                      <div className="flex-1">
                        <h3 className="font-medium text-slate-900 dark:text-white">{summary.title}</h3>
                        <div className="flex items-center gap-4 mt-2 text-sm text-slate-600 dark:text-slate-300">
                          <span className="flex items-center gap-1">
                            <Users className="w-4 h-4" />
                            {summary.collaborators} collaborators
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageSquare className="w-4 h-4" />
                            {summary.comments} comments
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            {summary.lastUpdate}
                          </span>
                        </div>
                      </div>
                      <Button variant="outline" size="sm">
                        <Eye className="w-4 h-4 mr-2" />
                        View
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AuthenticatedLayout>
  );
};

export default Collaboration;
