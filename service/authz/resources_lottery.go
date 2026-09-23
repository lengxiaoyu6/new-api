package authz

const ResourceLottery = "lottery"

var (
	LotteryRead    = Permission{Resource: ResourceLottery, Action: ActionRead}
	LotteryWrite   = Permission{Resource: ResourceLottery, Action: ActionWrite}
	LotteryPublish = Permission{Resource: ResourceLottery, Action: "publish"}
	LotteryOperate = Permission{Resource: ResourceLottery, Action: ActionOperate}
	LotteryStock   = Permission{Resource: ResourceLottery, Action: "stock"}
)

func init() {
	RegisterResource(ResourceDefinition{
		Resource: ResourceLottery,
		LabelKey: "Lottery management",
		Actions: []ActionDefinition{
			{Action: ActionRead, LabelKey: "View lottery activities", DescriptionKey: "View lottery activities, versions, prizes, and audit records."},
			{Action: ActionWrite, LabelKey: "Configure lottery activities", DescriptionKey: "Create lottery activities and configure their prizes."},
			{Action: "publish", LabelKey: "Publish lottery activities", DescriptionKey: "Publish lottery activities before they begin."},
			{Action: ActionOperate, LabelKey: "Operate lottery activities", DescriptionKey: "Pause, resume, or end lottery activities."},
			{Action: "stock", LabelKey: "Adjust lottery stock", DescriptionKey: "Add inventory to lottery balance prizes."},
		},
	})
}
